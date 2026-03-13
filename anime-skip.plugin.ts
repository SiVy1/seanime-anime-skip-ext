declare const $ui: any
declare const $storage: any

function init() {
  $ui.register((ctx: any) => {
    const tray = ctx.newTray({
      tooltipText: "Anime Skip",
      iconUrl: "https://api.anime-skip.com/favicon.ico",
      withContent: true,
    })

    const endpointRef = ctx.fieldRef("https://api.anime-skip.com/graphql")
    const clientIdRef = ctx.fieldRef("ZGfO0sMF3eCwLYf8yMSCJjlynwNGRXWE")
    const authTokenRef = ctx.fieldRef("")
    const queryRef = ctx.fieldRef("")
    const limitRef = ctx.fieldRef("10")
    const showIdRef = ctx.fieldRef("")
    const episodeNumberRef = ctx.fieldRef("")
    const detectedText = ctx.state("Auto-detect: not run")

    const resultText = ctx.state("Enter a search query and click Search Shows.")
    const loadedEpisodeText = ctx.state("Episode: not loaded")
    const timelineText = ctx.state("No episode timeline loaded.")
    const playbackText = ctx.state("Playback: not detected")
    const activeSegmentText = ctx.state("Active segment: none")
    const segmentsState = ctx.state([])

    const SKIP_TYPES: any = {
      Intro: true,
      Credits: true,
      Preview: true,
      Recap: true,
    }

    function parseNum(value: any): number | null {
      const n = typeof value === "number" ? value : parseFloat(String(value || ""))
      return isNaN(n) ? null : n
    }

    function toMmSs(seconds: number): string {
      const safe = Math.max(0, Math.floor(seconds || 0))
      const mm = Math.floor(safe / 60)
      const ss = safe % 60
      return mm + ":" + (ss < 10 ? "0" : "") + ss
    }

    function pickNumber(info: any, keys: string[]): number | null {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (info && info[key] !== undefined && info[key] !== null) {
          const parsed = parseNum(info[key])
          if (parsed !== null) return parsed
        }
      }
      return null
    }

    function getPlaybackInfoSafe(): any {
      try {
        return ctx.videoCore.getCurrentPlaybackInfo()
      } catch (error) {
        return null
      }
    }

    function getCurrentAndDuration(): { current: number | null; duration: number | null } {
      const info = getPlaybackInfoSafe() || {}
      const current = pickNumber(info, ["currentTime", "time", "timePos", "position", "elapsed"])
      const duration = pickNumber(info, ["duration", "totalDuration", "length", "mediaDuration"])
      return { current, duration }
    }

    function getCurrentMediaSafe(): any {
      try {
        return ctx.videoCore.getCurrentMedia()
      } catch (error) {
        return null
      }
    }

    function normalizeTitle(value: string): string {
      return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    }

    function extractMediaTitle(media: any): string {
      if (!media) return ""
      const titleObj = media.title || {}
      const candidates = [
        titleObj.userPreferred,
        titleObj.english,
        titleObj.romaji,
        titleObj.native,
        media.name,
        media.userPreferredTitle,
        media.englishTitle,
        media.romajiTitle,
      ]
      for (let i = 0; i < candidates.length; i++) {
        const v = String(candidates[i] || "").trim()
        if (v) return v
      }
      return ""
    }

    function detectEpisodeNumber(): string {
      const direct = String(episodeNumberRef.current || "").trim()
      if (direct) return direct

      const playback = getPlaybackInfoSafe() || {}
      const media = getCurrentMediaSafe() || {}
      const value = pickNumber(playback, ["episodeNumber", "episode", "number", "currentEpisode", "ep"]) ||
        pickNumber(media, ["episodeNumber", "episode", "number", "currentEpisode", "nextEpisode"])
      if (value === null) return ""
      return String(Math.floor(value))
    }

    function scoreShowMatch(targetTitle: string, show: any): number {
      const target = normalizeTitle(targetTitle)
      const showName = normalizeTitle(String(show && show.name ? show.name : ""))
      const originalName = normalizeTitle(String(show && show.originalName ? show.originalName : ""))
      const options = [showName, originalName]

      let best = 0
      for (let i = 0; i < options.length; i++) {
        const option = options[i]
        if (!option) continue
        if (option === target) best = Math.max(best, 100)
        else if (option.startsWith(target) || target.startsWith(option)) best = Math.max(best, 90)
        else if (option.includes(target) || target.includes(option)) best = Math.max(best, 75)
        else {
          const targetTokens = target.split(" ")
          const optionTokens = option.split(" ")
          let overlap = 0
          for (let j = 0; j < targetTokens.length; j++) {
            if (optionTokens.indexOf(targetTokens[j]) >= 0) overlap++
          }
          const tokenScore = targetTokens.length ? Math.floor((overlap / targetTokens.length) * 60) : 0
          best = Math.max(best, tokenScore)
        }
      }

      return best
    }

    async function resolveShowIdAuto(preferredShowId: string): Promise<{ showId: string; source: string; title: string }> {
      const explicit = String(preferredShowId || "").trim()
      if (explicit) {
        return { showId: explicit, source: "manual show ID", title: "" }
      }

      const media = getCurrentMediaSafe()
      const detectedTitle = extractMediaTitle(media)
      const fallbackTitle = String(queryRef.current || "").trim()
      const title = detectedTitle || fallbackTitle

      if (!title) {
        throw new Error("Could not detect current anime title. Start playback or enter Search shows text.")
      }

      const searchData = await graphQLRequest(
        "query SearchShows($search: String!, $limit: Int!) { searchShows(search: $search, limit: $limit) { id name originalName } }",
        { search: title, limit: 20 }
      )

      const shows = searchData.searchShows || []
      if (!shows.length) {
        throw new Error("No Anime Skip show found for detected title: " + title)
      }

      let bestShow = shows[0]
      let bestScore = scoreShowMatch(title, shows[0])

      for (let i = 1; i < shows.length; i++) {
        const score = scoreShowMatch(title, shows[i])
        if (score > bestScore) {
          bestScore = score
          bestShow = shows[i]
        }
      }

      return {
        showId: String(bestShow.id),
        source: "auto title match",
        title,
      }
    }

    function buildTimelineBar(duration: number, current: number | null, segments: any[]): string {
      if (duration <= 0) return "Timeline unavailable (duration unknown)."

      const width = 56
      const cells = []
      for (let i = 0; i < width; i++) cells.push("-")

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        const start = Math.max(0, Math.min(duration, segment.start || 0))
        const end = Math.max(start, Math.min(duration, segment.end || start))

        const startPos = Math.max(0, Math.min(width - 1, Math.floor((start / duration) * (width - 1))))
        const endPos = Math.max(startPos, Math.min(width - 1, Math.ceil((end / duration) * (width - 1))))
        const marker = String(segment.typeName || "?").slice(0, 1).toUpperCase()

        for (let p = startPos; p <= endPos; p++) cells[p] = marker
      }

      if (current !== null) {
        const currentPos = Math.max(0, Math.min(width - 1, Math.round((current / duration) * (width - 1))))
        cells[currentPos] = "●"
      }

      return "[" + cells.join("") + "]"
    }

    function findActiveSegment(currentSeconds: number | null): any {
      if (currentSeconds === null) return null
      const segments = segmentsState.get() || []
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        if (currentSeconds >= segment.start && currentSeconds < segment.end) {
          return segment
        }
      }
      return null
    }

    function refreshPlaybackUi() {
      const timeData = getCurrentAndDuration()
      const current = timeData.current
      const duration = timeData.duration

      if (current === null) {
        playbackText.set("Playback: not detected")
        activeSegmentText.set("Active segment: none")
        return
      }

      playbackText.set("Playback: " + toMmSs(current) + (duration !== null ? " / " + toMmSs(duration) : ""))

      const active = findActiveSegment(current)
      if (active) {
        activeSegmentText.set(
          "Active segment: " + active.typeName + " (" + toMmSs(active.start) + " - " + toMmSs(active.end) + ")"
        )
      } else {
        activeSegmentText.set("Active segment: none")
      }

      const segments = segmentsState.get() || []
      if (segments.length && duration !== null && duration > 0) {
        timelineText.set(buildTimelineBar(duration, current, segments))
      }
    }

    async function graphQLRequest(query: string, variables: any): Promise<any> {
      const endpoint = (endpointRef.current || "").trim()
      const clientId = (clientIdRef.current || "").trim()
      const authToken = (authTokenRef.current || "").trim()

      if (!endpoint) throw new Error("Endpoint is required")
      if (!clientId) throw new Error("X-Client-ID is required")

      const headers: any = {
        "content-type": "application/json",
        "x-client-id": clientId,
      }

      if (authToken) {
        headers.authorization = "Bearer " + authToken
      }

      const res = await ctx.fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      })

      const data = await res.json()
      if (data.errors && data.errors.length) {
        throw new Error(data.errors[0].message || "GraphQL error")
      }

      return data.data
    }

    function loadSettings() {
      const savedEndpoint = $storage.get("animeSkip.endpoint")
      const savedClientId = $storage.get("animeSkip.clientId")
      const savedAuthToken = $storage.get("animeSkip.authToken")
      const savedShowId = $storage.get("animeSkip.showId")
      const savedEpisodeNumber = $storage.get("animeSkip.episodeNumber")

      if (savedEndpoint) endpointRef.setValue(savedEndpoint)
      if (savedClientId) clientIdRef.setValue(savedClientId)
      if (savedAuthToken) authTokenRef.setValue(savedAuthToken)
      if (savedShowId) showIdRef.setValue(savedShowId)
      if (savedEpisodeNumber) episodeNumberRef.setValue(savedEpisodeNumber)
    }

    async function searchShows() {
      try {
        const endpoint = (endpointRef.current || "").trim()
        const clientId = (clientIdRef.current || "").trim()
        const authToken = (authTokenRef.current || "").trim()
        const search = (queryRef.current || "").trim()
        const limit = parseInt((limitRef.current || "10").trim(), 10)

        if (!endpoint) {
          ctx.toast.error("Endpoint is required")
          return
        }

        if (!clientId) {
          ctx.toast.error("X-Client-ID is required")
          return
        }

        if (!search) {
          ctx.toast.error("Enter a search query")
          return
        }

        const headers: any = {
          "content-type": "application/json",
          "x-client-id": clientId,
        }

        if (authToken) {
          headers.authorization = "Bearer " + authToken
        }

        const gqlQuery =
          "query SearchShows($search: String!, $limit: Int!) { searchShows(search: $search, limit: $limit) { id name originalName } }"

        const res = await ctx.fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: gqlQuery,
            variables: {
              search,
              limit: isNaN(limit) ? 10 : limit,
            },
          }),
        })

        const data = await res.json()

        if (data.errors && data.errors.length) {
          const message = data.errors[0].message || "GraphQL error"
          resultText.set("Error: " + message)
          ctx.toast.error("Anime Skip returned an error")
          return
        }

        const shows = (data.data && data.data.searchShows) || []
        if (!shows.length) {
          resultText.set("No results.")
          return
        }

        const lines = []
        for (let i = 0; i < shows.length; i++) {
          const s = shows[i]
          lines.push(
            i +
              1 +
              ". [" +
              s.id +
              "] " +
              s.name +
              (s.originalName ? " (" + s.originalName + ")" : "")
          )
        }

        resultText.set(lines.join("\n"))
      } catch (error: any) {
        resultText.set("Anime Skip API request failed.")
        ctx.toast.error(error && error.message ? error.message : "Request failed")
      }
    }

    async function loadEpisodeTimeline() {
      try {
        const showInfo = await resolveShowIdAuto((showIdRef.current || "").trim())
        const showId = showInfo.showId
        const episodeNumber = detectEpisodeNumber()

        if (!episodeNumber) {
          ctx.toast.error("Episode number is required (or must be detectable from current playback)")
          return
        }

        showIdRef.setValue(showId)
        episodeNumberRef.setValue(episodeNumber)
        detectedText.set(
          "Auto-detect: show via " +
            showInfo.source +
            (showInfo.title ? " (" + showInfo.title + ")" : "") +
            ", episode " +
            episodeNumber
        )

        const episodesData = await graphQLRequest(
          "query EpisodesByShow($showId: ID!) { findEpisodesByShowId(showId: $showId) { id number absoluteNumber name baseDuration } }",
          { showId }
        )

        const episodes = episodesData.findEpisodesByShowId || []
        let selected = null

        for (let i = 0; i < episodes.length; i++) {
          const ep = episodes[i]
          const n = String(ep.number || "").trim()
          const abs = String(ep.absoluteNumber || "").trim()
          if (n === episodeNumber || abs === episodeNumber) {
            selected = ep
            break
          }
        }

        if (!selected) {
          resultText.set("Episode not found for this show ID and episode number.")
          loadedEpisodeText.set("Episode: not loaded")
          segmentsState.set([])
          timelineText.set("No episode timeline loaded.")
          activeSegmentText.set("Active segment: none")
          return
        }

        const timestampsData = await graphQLRequest(
          "query TimestampsByEpisode($episodeId: ID!) { findTimestampsByEpisodeId(episodeId: $episodeId) { at type { name description } } }",
          { episodeId: selected.id }
        )

        const timestamps = (timestampsData.findTimestampsByEpisodeId || []).slice()
        timestamps.sort((a: any, b: any) => (a.at || 0) - (b.at || 0))

        const baseDuration = parseNum(selected.baseDuration) || 0
        const segments = []

        for (let i = 0; i < timestamps.length; i++) {
          const current = timestamps[i]
          const next = timestamps[i + 1]
          const typeName = current && current.type ? String(current.type.name || "") : ""

          if (!SKIP_TYPES[typeName]) continue

          const start = parseNum(current.at) || 0
          let end = start

          if (next) {
            end = parseNum(next.at) || start
          } else if (baseDuration > start) {
            end = baseDuration
          } else {
            end = start + 90
          }

          if (end <= start) continue
          segments.push({ typeName, start, end })
        }

        segmentsState.set(segments)
        loadedEpisodeText.set(
          "Episode: " + (selected.number ? "#" + selected.number + " " : "") + (selected.name || "Unnamed")
        )

        if (!segments.length) {
          timelineText.set("No skippable segments found for this episode.")
          activeSegmentText.set("Active segment: none")
          resultText.set("No Intro/Credits/Preview/Recap timestamps found.")
          return
        }

        const summary = []
        for (let i = 0; i < segments.length; i++) {
          const s = segments[i]
          summary.push(s.typeName + " " + toMmSs(s.start) + "-" + toMmSs(s.end))
        }
        resultText.set("Loaded " + segments.length + " segment(s): " + summary.join(", "))

        const timeData = getCurrentAndDuration()
        const effectiveDuration = timeData.duration && timeData.duration > 0 ? timeData.duration : baseDuration

        if (effectiveDuration > 0) {
          timelineText.set(buildTimelineBar(effectiveDuration, timeData.current, segments))
        } else {
          timelineText.set("Timeline loaded. Duration unavailable until playback metadata is ready.")
        }

        refreshPlaybackUi()
      } catch (error: any) {
        resultText.set("Failed to load episode timeline.")
        ctx.toast.error(error && error.message ? error.message : "Request failed")
      }
    }

    async function autoDetectAndLoadTimeline() {
      showIdRef.setValue("")
      await loadEpisodeTimeline()
    }

    function skipCurrentSegment() {
      try {
        const timeData = getCurrentAndDuration()
        const current = timeData.current
        const active = findActiveSegment(current)

        if (!active || current === null) {
          ctx.toast.info("No skippable segment is active right now")
          return
        }

        const delta = active.end - current + 0.05
        if (delta <= 0) {
          ctx.toast.info("Already at the end of this segment")
          return
        }

        ctx.videoCore.seek(delta)
        if (ctx.videoCore.showMessage) {
          ctx.videoCore.showMessage("Skipped " + active.typeName, 1500)
        }
      } catch (error) {
        ctx.toast.error("Skip failed")
      }
    }

    ctx.registerEventHandler("anime-skip-save", () => {
      $storage.set("animeSkip.endpoint", (endpointRef.current || "").trim())
      $storage.set("animeSkip.clientId", (clientIdRef.current || "").trim())
      $storage.set("animeSkip.authToken", (authTokenRef.current || "").trim())
      $storage.set("animeSkip.showId", (showIdRef.current || "").trim())
      $storage.set("animeSkip.episodeNumber", (episodeNumberRef.current || "").trim())
      ctx.toast.success("Settings saved")
    })

    ctx.registerEventHandler("anime-skip-search", async () => {
      await searchShows()
    })

    ctx.registerEventHandler("anime-skip-load-timeline", async () => {
      await loadEpisodeTimeline()
    })

    ctx.registerEventHandler("anime-skip-auto-load", async () => {
      await autoDetectAndLoadTimeline()
    })

    ctx.registerEventHandler("anime-skip-refresh-playback", () => {
      refreshPlaybackUi()
    })

    ctx.registerEventHandler("anime-skip-skip", () => {
      skipCurrentSegment()
    })

    loadSettings()
    refreshPlaybackUi()

    if (tray.onOpen) {
      tray.onOpen(() => {
        refreshPlaybackUi()
      })
    }

    if (ctx.playback && ctx.playback.registerEventListener) {
      try {
        ctx.playback.registerEventListener(() => {
          refreshPlaybackUi()
        })
      } catch (error) {
      }
    }

    tray.render(() => {
      return tray.stack([
        tray.text("Anime Skip GraphQL"),
        tray.text("Endpoint"),
        tray.input({ fieldRef: endpointRef }),
        tray.text("X-Client-ID"),
        tray.input({ fieldRef: clientIdRef }),
        tray.text("Auth token (optional)"),
        tray.input({ fieldRef: authTokenRef }),

        tray.text("Search shows"),
        tray.input({ fieldRef: queryRef }),
        tray.text("Search limit"),
        tray.input({ fieldRef: limitRef }),
        tray.button({ label: "Search Shows", onClick: "anime-skip-search" }),

        tray.text("Show ID"),
        tray.input({ fieldRef: showIdRef }),
        tray.text("Episode number"),
        tray.input({ fieldRef: episodeNumberRef }),
        tray.button({ label: "Load episode timeline", onClick: "anime-skip-load-timeline" }),
        tray.button({ label: "Auto-detect and load current episode", onClick: "anime-skip-auto-load" }),

        tray.button({ label: "Save settings", onClick: "anime-skip-save" }),
        tray.button({ label: "Refresh playback", onClick: "anime-skip-refresh-playback" }),
        tray.button({ label: "Skip current segment", onClick: "anime-skip-skip" }),

        tray.text(loadedEpisodeText.get()),
        tray.text(detectedText.get()),
        tray.text("Timeline legend: I=Intro, C=Credits, P=Preview, R=Recap, ●=Current position"),
        tray.text(timelineText.get()),
        tray.text(playbackText.get()),
        tray.text(activeSegmentText.get()),
        tray.text(resultText.get()),
      ])
    })
  })
}
