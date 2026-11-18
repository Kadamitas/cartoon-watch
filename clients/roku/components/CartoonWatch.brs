sub init()
    m.top.backgroundColor = "#0B0D14"
    m.top.backgroundUri = ""
    m.library = m.top.FindNode("library")
    m.menu = m.top.FindNode("menu")
    m.grid = m.top.FindNode("catalog")
    m.heading = m.top.FindNode("heading")
    m.status = m.top.FindNode("status")
    m.detail = m.top.FindNode("detail")
    m.episodeList = m.top.FindNode("episodes")
    m.video = m.top.FindNode("video")
    m.skip = m.top.FindNode("skip")
    m.loading = m.top.FindNode("loading")
    m.loadingText = m.top.FindNode("loadingText")
    m.registry = CreateObject("roRegistrySection", "CartoonWatch")
    m.service = m.registry.Read("service")
    m.positions = ParseJson(m.registry.Read("positions"))
    if type(m.positions) <> "roAssociativeArray" then m.positions = {}
    m.items = []
    m.episodes = []
    m.categories = ["all", "Dubbed anime", "Cartoons", "Subbed anime", "Movies", "OVA"]
    m.categoryNames = ["All categories", "Dubbed anime", "Cartoons", "Subbed anime", "Movies", "OVA"]
    m.category = "all"
    m.sort = "az"
    m.query = ""
    m.offset = 0
    m.total = 0
    m.requestId = 0
    m.detailData = invalid
    m.playingEpisode = invalid
    m.intro = invalid
    m.menu.buttons = ["Browse all", "Search", "Category", "Sort: A-Z", "Previous page", "Next page", "Service address"]
    m.menu.ObserveField("buttonSelected", "onMenuSelected")
    m.grid.ObserveField("itemSelected", "onTitleSelected")
    m.episodeList.ObserveField("itemSelected", "onEpisodeSelected")
    m.video.ObserveField("state", "onVideoState")
    m.video.ObserveField("position", "onPosition")
    m.skip.ObserveField("buttonSelected", "onSkipSelected")
    m.menu.SetFocus(true)
    if validService(m.service)
        loadCatalog()
    else
        showKeyboard("service")
    end if
end sub

function validService(value)
    if type(value) <> "roString" and type(value) <> "String" then return false
    return CreateObject("roRegex", "^https?://([A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?/?$", "i").IsMatch(value)
end function

sub setBusy(value, text = "Loading…")
    m.busy = value
    m.loading.visible = value
    m.loadingText.visible = value
    m.loadingText.text = text
end sub

sub request(action, path, query = invalid, body = invalid)
    if not validService(m.service)
        showKeyboard("service")
        return
    end if
    m.requestId++
    if m.task <> invalid
        m.task.UnobserveField("response")
        m.task.control = "STOP"
        m.top.RemoveChild(m.task)
    end if
    task = CreateObject("roSGNode", "ApiTask")
    method = "GET"
    if body <> invalid then method = "POST"
    task.request = { id: m.requestId, action: action, base: m.service, path: path, query: query, method: method, body: body }
    task.ObserveField("response", "onResponse")
    m.task = task
    m.top.AppendChild(task)
    setBusy(true)
    if action = "play" then m.loadingText.text = "Finding a working player…"
    task.control = "RUN"
end sub

sub onResponse(event)
    response = event.GetData()
    if response = invalid or response.id <> m.requestId then return
    if m.task <> invalid
        m.top.RemoveChild(m.task)
        m.task = invalid
    end if
    setBusy(false)
    if response.error <> ""
        message = response.error
        if Instr(1, LCase(message), "http") > 0 then message = "This title could not be loaded. Try again or choose another title."
        m.status.text = message
        showMessage("Unable to load", message)
        return
    end if
    if response.action = "catalog"
        showCatalog(response.data)
    else if response.action = "details"
        showDetails(response.data)
    else if response.action = "play"
        startPlayback(response.data)
    end if
end sub

sub loadCatalog()
    request("catalog", "/api/catalog", { q: m.query, category: m.category, sort: m.sort, offset: m.offset, limit: 60 })
end sub

sub showCatalog(data)
    m.items = data.items
    if type(m.items) <> "roArray" then m.items = []
    m.total = data.total
    if m.total = invalid then m.total = m.items.Count()
    content = CreateObject("roSGNode", "ContentNode")
    for each item in m.items
        node = content.CreateChild("ContentNode")
        node.title = item.title
        if item.image <> invalid then node.HDPosterUrl = item.image
    end for
    m.grid.content = content
    label = "WCO catalog"
    if m.query <> "" then label = "Search: " + m.query
    m.heading.text = label
    first = 0
    if m.items.Count() > 0 then first = m.offset + 1
    m.status.text = first.ToStr() + "–" + (m.offset + m.items.Count()).ToStr() + " of " + m.total.ToStr() + " titles · " + categoryName() + Chr(10) + "Left: menu   OK: select   Back: return"
    m.library.visible = true
    m.detail.visible = false
    if m.items.Count() > 0 then m.grid.SetFocus(true) else m.menu.SetFocus(true)
end sub

function categoryName()
    for index = 0 to m.categories.Count() - 1
        if m.categories[index] = m.category then return m.categoryNames[index]
    end for
    return "All categories"
end function

sub onMenuSelected(event)
    index = event.GetData()
    if index = 0
        m.query = ""
        m.category = "all"
        m.offset = 0
        loadCatalog()
    else if index = 1
        showKeyboard("search")
    else if index = 2
        dialog = CreateObject("roSGNode", "StandardMessageDialog")
        dialog.title = "Category"
        dialog.buttons = m.categoryNames
        dialog.ObserveField("buttonSelected", "onCategorySelected")
        m.top.dialog = dialog
    else if index = 3
        if m.sort = "az" then m.sort = "za" else m.sort = "az"
        if m.sort = "az" then label = "Sort: A-Z" else label = "Sort: Z-A"
        m.menu.buttons = ["Browse all", "Search", "Category", label, "Previous page", "Next page", "Service address"]
        m.offset = 0
        loadCatalog()
    else if index = 4
        if m.offset > 0
            m.offset = m.offset - 60
            loadCatalog()
        end if
    else if index = 5
        if m.offset + m.items.Count() < m.total
            m.offset = m.offset + 60
            loadCatalog()
        end if
    else if index = 6
        showKeyboard("service")
    end if
end sub

sub onCategorySelected(event)
    index = event.GetData()
    if index >= 0 and index < m.categories.Count()
        m.category = m.categories[index]
        m.offset = 0
        m.top.dialog.close = true
        loadCatalog()
    end if
end sub

sub showKeyboard(purpose)
    m.keyboardPurpose = purpose
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.buttons = ["Save", "Cancel"]
    if purpose = "search"
        dialog.title = "Search WCO"
        dialog.text = m.query
    else
        dialog.title = "Companion service address"
        dialog.message = ["Start the companion on a computer on the same network. Enter its displayed HTTP address."]
        dialog.text = m.service
    end if
    dialog.ObserveField("buttonSelected", "onKeyboardSelected")
    m.top.dialog = dialog
end sub

sub onKeyboardSelected(event)
    dialog = m.top.dialog
    if event.GetData() <> 0
        dialog.close = true
        return
    end if
    value = dialog.text.Trim()
    if m.keyboardPurpose = "service"
        while value.Right(1) = "/"
            value = value.Left(value.Len() - 1)
        end while
        if not validService(value)
            dialog.message = ["Enter an HTTP or HTTPS address with a host and optional port."]
            return
        end if
        m.service = value
        m.registry.Write("service", value)
        m.registry.Flush()
    else
        m.query = value
    end if
    dialog.close = true
    m.offset = 0
    loadCatalog()
end sub

sub showMessage(title, message)
    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = title
    dialog.message = [message]
    dialog.buttons = ["OK"]
    dialog.ObserveField("buttonSelected", "closeMessage")
    m.top.dialog = dialog
end sub

sub closeMessage()
    m.top.dialog.close = true
end sub

sub onTitleSelected(event)
    index = event.GetData()
    if index < 0 or index >= m.items.Count() then return
    m.selected = m.items[index]
    request("details", "/api/details", { url: m.selected.url })
end sub

sub showDetails(data)
    m.detailData = data
    if data.kind = invalid then data.kind = m.selected.kind
    if m.selected.kind = "movie" then data.kind = "movie"
    m.top.FindNode("detailTitle").text = data.title
    description = data.description
    if description = invalid then description = ""
    m.top.FindNode("description").text = description
    m.episodes = data.episodes
    if type(m.episodes) <> "roArray" then m.episodes = []
    if data.kind = "movie" or m.episodes.Count() = 0
        m.episodes = [{ title: "Play " + data.title, url: data.url, kind: data.kind }]
    end if
    content = CreateObject("roSGNode", "ContentNode")
    for each episode in m.episodes
        content.CreateChild("ContentNode").title = episode.title
    end for
    m.episodeList.content = content
    heading = m.episodes.Count().ToStr() + " episodes"
    if data.kind = "movie" then heading = "Watch movie"
    m.top.FindNode("episodeHeading").text = heading
    m.library.visible = false
    m.detail.visible = true
    m.episodeList.SetFocus(true)
end sub

sub onEpisodeSelected(event)
    playEpisode(event.GetData())
end sub

sub playEpisode(index)
    if index < 0 or index >= m.episodes.Count() then return
    item = m.episodes[index]
    kind = m.detailData.kind
    if kind <> "movie" then kind = "episode"
    target = { title: item.title, url: item.url, seriesTitle: m.detailData.title, seriesUrl: m.detailData.url, kind: kind, resumeSeconds: 0 }
    if kind = "movie" then target.title = m.detailData.title
    if item.number <> invalid then target.number = item.number
    if item.season <> invalid then target.season = item.season
    if m.positions[item.url] <> invalid then target.resumeSeconds = m.positions[item.url]
    m.playingEpisode = target
    m.excludedSources = []
    m.playingSource = invalid
    m.savedBucket = -1
    request("play", "/api/play", invalid, target)
end sub

sub startPlayback(data)
    if data.streamUrl = invalid
        showMessage("No player available", "No working player was found for this episode.")
        return
    end if
    content = CreateObject("roSGNode", "ContentNode")
    m.playingSource = data.source
    content.title = data.title
    content.url = data.streamUrl
    content.streamFormat = "hls"
    if data.format <> invalid then content.streamFormat = data.format
    if content.streamFormat <> "hls" and content.streamFormat <> "mp4" and content.streamFormat <> "dash" and content.streamFormat <> "mkv" then content.streamFormat = "hls"
    content.PlayStart = m.playingEpisode.resumeSeconds
    tracks = []
    if type(data.subtitles) = "roArray"
        for each subtitle in data.subtitles
            trackUrl = subtitle.url
            supported = subtitle.format = "srt" or subtitle.format = "ttml" or subtitle.format = "dfxp"
            if subtitle.srtUrl <> invalid
                trackUrl = subtitle.srtUrl
                supported = true
            end if
            if trackUrl <> invalid and supported
                language = subtitle.language
                if language = invalid then language = "eng"
                label = subtitle.label
                if label = invalid then label = language
                tracks.Push({ Language: language, Description: label, TrackName: trackUrl })
            end if
        end for
    end if
    if tracks.Count() > 0 then content.SubtitleTracks = tracks
    m.intro = invalid
    if type(data.intro) = "roArray" and data.intro.Count() = 2
        first = numeric(data.intro[0])
        last = numeric(data.intro[1])
        if first >= 0 and last > first and last < 86400 then m.intro = [first, last]
    end if
    m.video.content = content
    m.video.visible = true
    m.video.SetFocus(true)
    m.video.control = "play"
end sub

function numeric(value)
    name = type(value)
    if name = "Integer" or name = "roInt" or name = "Float" or name = "roFloat" or name = "Double" or name = "roDouble" or name = "LongInteger" or name = "roLongInteger" then return value
    return -1
end function

sub onPosition()
    available = false
    if m.intro <> invalid and m.video.visible
        available = m.video.position >= m.intro[0] and m.video.position < m.intro[1]
    end if
    m.skip.visible = available
    if not available and m.skip.HasFocus() then m.video.SetFocus(true)
    bucket = Int(m.video.position / 30)
    if m.video.visible and bucket > 0 and bucket <> m.savedBucket
        m.savedBucket = bucket
        savePosition()
    end if
end sub

sub onSkipSelected()
    if m.intro <> invalid and m.skip.visible
        m.video.seek = m.intro[1]
        m.video.SetFocus(true)
    end if
end sub

sub onVideoState()
    if not m.video.visible then return
    if m.video.state = "error"
        stopPlayback()
        if m.playingSource <> invalid and m.excludedSources.Count() < 3
            m.excludedSources.Push(m.playingSource)
            m.playingEpisode.exclude = m.excludedSources
            m.playingEpisode.resumeSeconds = Int(m.video.position)
            request("play", "/api/play", invalid, m.playingEpisode)
        else
            showMessage("Playback unavailable", "This stream could not be played on this Roku. Choose another episode or try again.")
        end if
    else if m.video.state = "finished"
        stopPlayback(true)
    end if
end sub

sub savePosition()
    if m.playingEpisode = invalid then return
    position = Int(m.video.position)
    if position > 5 then m.positions[m.playingEpisode.url] = position
    if m.positions.Count() > 40
        for each key in m.positions.Keys()
            m.positions.Delete(key)
            if m.positions.Count() <= 40 then exit for
        end for
    end if
    m.registry.Write("positions", FormatJson(m.positions))
    m.registry.Flush()
end sub

sub stopPlayback(finished = false)
    if finished and m.playingEpisode <> invalid
        m.positions.Delete(m.playingEpisode.url)
        m.registry.Write("positions", FormatJson(m.positions))
        m.registry.Flush()
    else
        savePosition()
    end if
    m.video.control = "stop"
    m.video.visible = false
    m.skip.visible = false
    m.episodeList.SetFocus(true)
end sub

function onKeyEvent(key, press)
    if not press then return false
    if m.busy
        if key = "back"
            m.requestId++
            if m.task <> invalid then m.task.control = "STOP"
            setBusy(false)
            return true
        end if
        return true
    end if
    if m.video.visible
        if key = "back"
            stopPlayback()
            return true
        else if key = "up" and m.skip.visible
            m.skip.SetFocus(true)
            return true
        else if key = "down" and m.skip.HasFocus()
            m.video.SetFocus(true)
            return true
        end if
        return false
    end if
    if m.detail.visible
        if key = "back"
            m.detail.visible = false
            m.library.visible = true
            m.grid.SetFocus(true)
            return true
        end if
    else
        if key = "search"
            showKeyboard("search")
            return true
        end if
        if key = "left" and m.grid.HasFocus() and m.grid.itemFocused mod 4 = 0
            m.menu.SetFocus(true)
            return true
        else if key = "right" and m.menu.IsInFocusChain() and m.items.Count() > 0
            m.grid.SetFocus(true)
            return true
        else if key = "back" and not m.menu.IsInFocusChain()
            m.menu.SetFocus(true)
            return true
        end if
    end if
    return false
end function

function seekVideo(position)
    status = "success"
    if position < 0
        position = 0
        status = "success.seek-start"
    else if m.video.duration > 0 and position >= m.video.duration
        position = m.video.duration - 0.1
        status = "success.seek-end"
    end if
    m.video.seek = position
    return { status: status }
end function

function episodeNumber(item)
    if item.number <> invalid then return Val(item.number.ToStr())
    if item.title <> invalid
        match = CreateObject("roRegex", "episode\s*([0-9]+)", "i").Match(item.title)
        if match.Count() > 1 then return Val(match[1])
    end if
    return -1
end function

function nextEpisode()
    if m.playingEpisode = invalid or m.playingEpisode.kind = "movie" then return -1
    number = episodeNumber(m.playingEpisode)
    if number < 0 then return -1
    answer = -1
    for index = 0 to m.episodes.Count() - 1
        item = m.episodes[index]
        sameSeason = true
        if m.playingEpisode.season <> invalid and item.season <> invalid then sameSeason = m.playingEpisode.season.ToStr() = item.season.ToStr()
        if sameSeason and episodeNumber(item) = number + 1
            if answer >= 0 then return -1
            answer = index
        end if
    end for
    return answer
end function

function handleTransport(info)
    if info = invalid or m.busy then return { status: "error.generic" }
    command = info.command
    if command = "play" or command = "resume"
        if m.video.visible
            m.video.control = "resume"
        else if m.detail.visible
            playEpisode(m.episodeList.itemFocused)
        else if m.grid.content <> invalid and m.items.Count() > 0
            index = m.grid.itemFocused
            if index < 0 or index >= m.items.Count() then return { status: "error.generic" }
            m.selected = m.items[index]
            request("details", "/api/details", { url: m.selected.url })
        else
            return { status: "error.generic" }
        end if
        return { status: "success" }
    end if
    if not m.video.visible then return { status: "error.generic" }
    if command = "pause" or command = "stop"
        m.video.control = "pause"
    else if command = "forward"
        return seekVideo(m.video.position + 10)
    else if command = "rewind" or command = "replay"
        return seekVideo(m.video.position - 10)
    else if command = "seek"
        if info.duration = invalid then return { status: "error.generic" }
        duration = Val(info.duration.ToStr())
        if duration < 0 or duration > 86400 then return { status: "error.generic" }
        if info.direction = "backward" then duration = -duration
        return seekVideo(m.video.position + duration)
    else if command = "startover"
        return seekVideo(0)
    else if command = "skip"
        if m.intro = invalid or m.video.position < m.intro[0] or m.video.position >= m.intro[1] then return { status: "error.generic" }
        return seekVideo(m.intro[1])
    else if command = "next"
        index = nextEpisode()
        if index < 0 then return { status: "error.generic" }
        m.video.control = "stop"
        m.video.visible = false
        m.skip.visible = false
        playEpisode(index)
    else
        return { status: "unhandled" }
    end if
    return { status: "success" }
end function
