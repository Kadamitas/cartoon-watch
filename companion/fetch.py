import json
import sys
import urllib.request

request=json.load(sys.stdin)
headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36','Accept':'text/html,application/xhtml+xml','Accept-Language':'en-US,en;q=0.9'}
with urllib.request.urlopen(urllib.request.Request(request['url'],headers=headers),timeout=15) as response:
    body=response.read(6500000)
    json.dump({'url':response.url,'html':body.decode('utf-8','replace')},sys.stdout)
