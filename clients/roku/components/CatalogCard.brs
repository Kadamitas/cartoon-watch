sub init()
    m.frame = m.top.FindNode("frame")
    m.poster = m.top.FindNode("poster")
    m.title = m.top.FindNode("title")
end sub

sub showContent()
    item = m.top.itemContent
    if item = invalid then return
    m.title.text = item.title
    if item.HDPosterUrl <> ""
        m.poster.uri = item.HDPosterUrl
    else
        m.poster.uri = "pkg:/images/card.png"
    end if
end sub

sub showFocus()
    if m.top.itemHasFocus and m.top.gridHasFocus
        m.frame.color = "#FF795B"
    else
        m.frame.color = "#253045"
    end if
end sub
