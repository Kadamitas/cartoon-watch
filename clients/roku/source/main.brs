sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    scene = screen.CreateScene("CartoonWatch")
    input = CreateObject("roInput")
    input.SetMessagePort(port)
    input.EnableTransportEvents()
    screen.Show()
    while true
        message = wait(0, port)
        if type(message) = "roSGScreenEvent" and message.IsScreenClosed() then return
        if type(message) = "roInputEvent"
            info = message.GetInfo()
            if info.type = "transport"
                response = scene.CallFunc("handleTransport", info)
                if response = invalid then response = { status: "unhandled" }
                response.id = info.id
                input.EventResponse(response)
            end if
        end if
    end while
end sub
