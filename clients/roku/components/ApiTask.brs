sub init()
    m.top.functionName = "runRequest"
end sub

sub runRequest()
    request = m.top.request
    if request = invalid then return
    result = { id: request.id, action: request.action, data: invalid, error: "" }
    transfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    transfer.SetPort(port)
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    address = request.base + request.path
    if request.query <> invalid
        separator = "?"
        for each key in request.query
            address += separator + transfer.Escape(key) + "=" + transfer.Escape(request.query[key].ToStr())
            separator = "&"
        end for
    end if
    transfer.SetUrl(address)
    transfer.AddHeader("Accept", "application/json")
    if request.method = "POST"
        transfer.AddHeader("Content-Type", "application/json")
        started = transfer.AsyncPostFromString(FormatJson(request.body))
    else
        started = transfer.AsyncGetToString()
    end if
    if not started
        result.error = "The service request could not start."
    else
        message = wait(90000, port)
        if type(message) = "roUrlEvent"
            code = message.GetResponseCode()
            data = ParseJson(message.GetString())
            if code >= 200 and code < 300 and type(data) = "roAssociativeArray"
                if data.error <> invalid
                    result.error = data.error
                else
                    result.data = data
                end if
            else if type(data) = "roAssociativeArray" and data.error <> invalid
                result.error = data.error
            else
                result.error = "The service is unavailable. Check its address and that it is running."
            end if
        else
            transfer.AsyncCancel()
            result.error = "The service took too long to respond. Try again."
        end if
    end if
    m.top.response = result
end sub
