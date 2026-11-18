sub Main()
    m.failures = 0
    m.busy = false
    m.video = { visible: true, position: 120, duration: 1000, control: "", seek: -1 }
    m.intro = [100, 160]
    expect(handleTransport({ command: "pause" }).status = "success" and m.video.control = "pause", "voice pause")
    expect(handleTransport({ command: "resume" }).status = "success" and m.video.control = "resume", "voice resume")
    expect(handleTransport({ command: "seek", duration: "40", direction: "backward" }).status = "success" and m.video.seek = 80, "voice relative seek")
    expect(handleTransport({ command: "startover" }).status = "success" and m.video.seek = 0, "voice start over")
    expect(handleTransport({ command: "skip" }).status = "success" and m.video.seek = 160, "source supplied intro")
    m.video.position = 200
    expect(handleTransport({ command: "skip" }).status = "error.generic", "no skip outside intro")
    m.intro = invalid
    expect(handleTransport({ command: "skip" }).status = "error.generic", "no invented intro")
    expect(handleTransport({ command: "seek", duration: "90000" }).status = "error.generic", "invalid seek range")
    expect(seekVideo(-5).status = "success.seek-start" and m.video.seek = 0, "seek lower bound")
    expect(seekVideo(2000).status = "success.seek-end" and m.video.seek < 1000, "seek upper bound")
    expect(handleTransport({ command: "unknown" }).status = "unhandled", "unknown transport")
    m.busy = true
    expect(handleTransport({ command: "pause" }).status = "error.generic", "busy voice rejected")
    m.busy = false
    m.video.visible = false
    expect(handleTransport({ command: "pause" }).status = "error.generic", "no invisible playback")
    expect(validService("http://192.0.2.2:8787"), "LAN companion address")
    expect(validService("https://watch.local"), "hostname companion address")
    expect(not validService("javascript:alert(1)"), "invalid address rejected")
    expect(not validService("http://host/path"), "service root required")
    m.playingEpisode = { kind: "episode", title: "Naruto Episode 3", season: 1 }
    m.episodes = [{ title: "Naruto Episode 5", season: 1 }, { title: "Naruto Episode 4", season: 1 }, { title: "Naruto Episode 3", season: 1 }]
    expect(nextEpisode() = 1, "next episode in descending catalog")
    m.episodes.Push({ title: "Naruto Episode 4", season: 1 })
    expect(nextEpisode() = -1, "ambiguous next episode rejected")
    m.episodes = [{ title: "Naruto Episode 4", season: 2 }]
    expect(nextEpisode() = -1, "season boundary respected")
    m.playingEpisode = { kind: "movie", title: "Movie" }
    expect(nextEpisode() = -1, "movie has no next episode")
    if m.failures = 0 then print "ROKU_LOGIC_PASS"
end sub

sub expect(value, name)
    if not value
        print "FAIL: "; name
        m.failures++
    end if
end sub
