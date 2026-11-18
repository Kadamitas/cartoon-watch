sub Main()
    m.failures = 0
    m.assertions = 0
    m.top = mockNode("Scene")
    m.top.nodes = {}
    for each name in ["library", "menu", "catalog", "heading", "status", "detail", "episodes", "video", "skip", "loading", "loadingText", "genreChooser", "genres", "genreHeading", "genreHelp", "detailTitle", "description", "episodeHeading"]
        m.top.nodes[name] = mockNode(name)
    end for
    m.top.nodes.library.visible = true
    init()
    expect(m.menu.buttons.Count() = 12 and m.menu.buttons[0] = "Trending this week" and m.menu.buttons[1] = "Anime categories" and m.menu.buttons[2] = "Cartoon collections", "discovery menu")
    expect(m.task.request.action = "discovery" and m.task.request.path = "/api/trending" and m.task.request.query = invalid, "weekly startup endpoint")
    expect(m.genreKeys.Count() = 20 and m.genreKeys[0] = "isekai" and m.cartoonKeys.Count() = 8, "shared category registry")
    weekly = [{ title: "Z first by activity", url: "https://www.wcostream.tv/anime/first", kind: "series" }, { title: "A second by activity", url: "https://www.wcostream.tv/anime/second", kind: "series" }]
    onResponse(response("discovery", { items: weekly, genre: "", available: true, stale: false, periodEnd: "2026-11-18T00:00:00Z" }))
    expect(m.mode = "discovery" and m.items[0].title = weekly[0].title and m.grid.content.children[1].title = weekly[1].title, "weekly order preserved")
    expect(m.heading.text = "Trending this week" and Instr(1, m.status.text, "AniList activity") > 0 and Instr(1, m.status.text, "2026-11-18") > 0, "weekly source and period")
    onTitleSelected(event(1))
    expect(m.task.request.action = "details" and m.task.request.query.url = weekly[1].url, "ranked title selection")
    onResponse(response("details", { title: "Second series", url: weekly[1].url, kind: "series", episodes: [{ title: "Episode 3", url: "https://www.wco.tv/second-episode-3", number: 3 }] }))
    expect(m.detail.visible and m.episodes.Count() = 1, "ranked title episodes")
    expect(onKeyEvent("back", true) and m.library.visible and m.mode = "discovery", "details back preserves discovery")
    onMenuSelected(event(1))
    expect(m.genreChooser.visible and m.genreList.content.children.Count() = 20 and m.genreList.content.children[0].title = "Isekai", "scrollable anime category chooser")
    onGenreSelected(event(keyIndex(m.genreKeys, "fighting")))
    expect(m.task.request.action = "discovery" and m.task.request.query.genre = "fighting", "fighting endpoint")
    oldId = m.requestId - 1
    onResponse(event({ id: oldId, action: "discovery", data: { items: [] }, error: "" }))
    expect(m.busy and m.items.Count() = 2, "stale feed response ignored")
    fighting = []
    for index = 0 to 48
        fighting.Push({ title: "Fighter " + index.ToStr(), url: "https://www.wcostream.tv/anime/fighter-" + index.ToStr(), kind: "series" })
    end for
    fighting.Push({ title: "Baki (2018)", url: "https://www.wcostream.tv/anime/baki-2018", kind: "series" })
    onResponse(response("discovery", { items: fighting, genre: "fighting", available: true, stale: true }))
    expect(m.items.Count() = 50 and m.items[49].title = "Baki (2018)", "genre list retains Baki beyond twenty")
    expect(m.heading.text = "All-time popular · Fighting" and Instr(1, m.status.text, "Saved feed") > 0 and Instr(1, m.status.text, "popularity") > 0, "genre metric and cache marker")
    m.offset = 60
    m.total = 300
    before = m.requestId
    onMenuSelected(event(8))
    onMenuSelected(event(9))
    onMenuSelected(event(7))
    expect(m.requestId = before and m.offset = 60 and m.sort = "az", "ranking ignores catalog pagination and sort")
    expect(Instr(1, m.status.text, "Saved feed") > 0 and m.top.dialog.title = "Catalog sort", "sort notice preserves ranking provenance")
    closeMessage()
    m.offset = 0
    m.total = m.items.Count()
    onMenuSelected(event(1))
    before = m.requestId
    expect(onKeyEvent("back", true) and not m.genreChooser.visible and m.library.visible and m.requestId = before, "genre chooser back without request")
    onMenuSelected(event(2))
    expect(m.choiceKeys.Count() = 8 and m.top.nodes.genreHeading.text = "Cartoon collections", "cartoon category chooser")
    onGenreSelected(event(keyIndex(m.choiceKeys, "cartoon-essentials")))
    expect(m.task.request.query.genre = "cartoon-essentials", "cartoon collection endpoint")
    cartoons = [{ title: "Teen Titans", url: "https://www.wcostream.tv/anime/teen-titans", kind: "series" }, { title: "Avatar The Last Airbender Book 1 Water", url: "https://www.wcostream.tv/anime/avatar-the-last-airbender-book-1-water", kind: "series" }]
    onResponse(response("discovery", { items: cartoons, type: "cartoons", source: "TVmaze", available: true, snapshotAt: "2026-11-18T07:03:21Z" }))
    expect(m.heading.text = "Cartoon essentials" and m.items[0].title = "Teen Titans", "cartoon order and label")
    expect(Instr(1, m.status.text, "Curated picks") > 0 and Instr(1, m.status.text, "TVmaze ratings") > 0 and Instr(1, m.status.text, "2026-11-18") > 0 and Instr(1, m.status.text, "AniList") = 0, "cartoon snapshot provenance")
    onTitleSelected(event(1))
    expect(m.task.request.query.url = cartoons[1].url, "cartoon title selection")
    onResponse(response("details", { title: cartoons[1].title, url: cartoons[1].url, kind: "series", episodes: [{ title: "Episode 1", url: "https://www.wco.tv/avatar-episode-1", number: 1 }] }))
    expect(onKeyEvent("back", true) and m.genre = "cartoon-essentials", "cartoon detail back preserves collection")
    onMenuSelected(event(5))
    m.top.dialog.text = "Baki"
    onKeyboardSelected(event(0))
    expect(m.task.request.action = "catalog" and m.task.request.query.q = "Baki" and m.task.request.query.offset = 0, "search returns to catalog endpoint")
    onResponse(response("catalog", { items: [fighting[49]], total: 1 }))
    expect(m.mode = "catalog" and m.genre = "" and m.heading.text = "Search: Baki", "search resets discovery mode")
    onMenuSelected(event(7))
    expect(m.task.request.query.sort = "za" and m.menu.buttons[0] = "Trending this week" and m.menu.buttons.Count() = 12, "catalog sort preserves discovery menu")
    onResponse(response("catalog", { items: [fighting[49]], total: 1 }))
    onMenuSelected(event(4))
    expect(m.task.request.path = "/api/catalog" and m.task.request.query.q = "" and m.task.request.query.category = "all", "browse all resets catalog filters")
    catalog = []
    for index = 0 to 59
        catalog.Push({ title: "Catalog " + index.ToStr(), url: "https://www.wcostream.tv/anime/catalog-" + index.ToStr(), kind: "series" })
    end for
    onResponse(response("catalog", { items: catalog, total: 16167 }))
    onMenuSelected(event(9))
    expect(m.offset = 60 and m.task.request.query.offset = 60, "catalog next page")
    onResponse(response("catalog", { items: catalog, total: 16167 }))
    onMenuSelected(event(8))
    expect(m.offset = 0 and m.task.request.query.offset = 0, "catalog previous page")
    onResponse(response("catalog", { items: catalog, total: 16167 }))
    onMenuSelected(event(6))
    onCategorySelected(event(3))
    expect(m.task.request.query.category = "Subbed anime" and m.task.request.query.offset = 0, "catalog category endpoint")
    onResponse(response("catalog", { items: catalog, total: 16167 }))
    onMenuSelected(event(3))
    expect(m.task.request.path = "/api/catalog" and m.task.request.query.category = "Movies" and m.task.request.query.q = "", "movies quick access")
    onResponse(response("catalog", { items: catalog, total: 6079 }))
    expect(m.heading.text = "Movies" and m.mode = "catalog", "movies remain catalog browsing")
    onMenuSelected(event(10))
    m.top.dialog.text = "http://new.watch.test:8765/"
    onKeyboardSelected(event(0))
    expect(m.task.request.action = "discovery" and m.task.request.base = "http://new.watch.test:8765" and m.task.request.query = invalid, "new service starts weekly discovery")
    cancelledId = m.requestId
    expect(onKeyEvent("back", true) and not m.busy and m.task = invalid and m.top.children.Count() = 0, "cancel removes task")
    onResponse(event({ id: cancelledId, action: "discovery", data: { items: weekly }, error: "" }))
    expect(m.mode = "catalog" and m.items.Count() = 60, "cancelled discovery cannot replace catalog")
    onMenuSelected(event(0))
    onResponse(response("discovery", invalid, "HTTP 500 https://internal.test/feed"))
    expect(m.mode = "discovery" and m.items.Count() = 0 and Instr(1, m.status.text, "unavailable") > 0 and Instr(1, m.status.text, "Browse all") > 0, "feed failure offers full catalog")
    expect(Instr(1, m.status.text, "http") = 0, "feed failure hides internal addresses")
    loadDiscovery("fighting")
    onResponse(response("discovery", { items: [], available: true }))
    expect(m.items.Count() = 0 and Instr(1, m.status.text, "No matching WCO") > 0, "empty feed does not invent rankings")
    before = m.requestId
    onTitleSelected(event(0))
    onGenreSelected(event(-1))
    expect(m.requestId = before, "out of range selections ignored")
    if m.failures = 0 then print "ROKU_DISCOVERY_PASS "; m.assertions
end sub

function keyIndex(keys, value)
    for index = 0 to keys.Count() - 1
        if keys[index] = value then return index
    end for
    return -1
end function

function event(value)
    return { value: value, GetData: eventData }
end function

function eventData()
    return m.value
end function

function response(action, data, error = "")
    return event({ id: m.requestId, action: action, data: data, error: error })
end function

function mockCreateObject(kind, name = invalid, extra = invalid)
    if kind = "roSGNode" then return mockNode(name)
    if kind = "roRegistrySection" then return { values: { service: "http://watch.test:8765", positions: "{}" }, Read: registryRead, Write: registryWrite, Flush: mockFlush }
    return CreateObject(kind, name, extra)
end function

function mockNode(kind)
    return { kind: kind, visible: false, focused: false, children: [], observers: {}, itemFocused: 0, FindNode: mockFindNode, SetFocus: mockSetFocus, HasFocus: mockHasFocus, IsInFocusChain: mockHasFocus, ObserveField: mockObserve, UnobserveField: mockUnobserve, AppendChild: mockAppend, RemoveChild: mockRemove, CreateChild: mockCreateChild }
end function

function mockFindNode(name)
    return m.nodes[name]
end function

sub mockSetFocus(value)
    m.focused = value
end sub

function mockHasFocus()
    return m.focused
end function

sub mockObserve(field, callback)
    m.observers[field] = callback
end sub

sub mockUnobserve(field)
    m.observers.Delete(field)
end sub

sub mockAppend(child)
    m.children.Push(child)
end sub

sub mockRemove(child)
    for index = 0 to m.children.Count() - 1
        if m.children[index].request.id = child.request.id
            m.children.Delete(index)
            exit for
        end if
    end for
end sub

function mockCreateChild(kind)
    node = mockNode(kind)
    m.children.Push(node)
    return node
end function

function registryRead(name)
    if m.values[name] = invalid then return ""
    return m.values[name]
end function

sub registryWrite(name, value)
    m.values[name] = value
end sub

sub mockFlush()
end sub

sub expect(value, name)
    m.assertions++
    if not value
        print "FAIL: "; name
        m.failures++
    end if
end sub
