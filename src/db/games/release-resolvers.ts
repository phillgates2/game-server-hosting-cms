/** Small parsers embedded in the installers; Python 3 runs on the game node.
 * They fail closed when upstream metadata changes instead of installing an
 * old hard-coded fallback and reporting it as an update.
 */
export const ETLEGACY_RELEASE_PARSER = String.raw`
import sys, re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.href = None
        self.text = []
        self.links = {}
    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.href = dict(attrs).get("href")
            self.text = []
    def handle_data(self, data):
        if self.href is not None:
            self.text.append(data)
    def handle_endtag(self, tag):
        if tag == "a" and self.href is not None:
            label = " ".join("".join(self.text).split())
            url = urljoin("https://www.etlegacy.com/download", self.href)
            parsed = urlparse(url)
            if parsed.scheme == "https" and parsed.netloc == "www.etlegacy.com" and re.fullmatch(r"/download/file/[0-9]+", parsed.path):
                self.links.setdefault(label, url)
            self.href = None

page = sys.stdin.read()
version = re.search(r"stable release\s+([0-9]+\.[0-9]+\.[0-9]+)", page, re.I)
parser = Links()
parser.feed(page)
labels = ["x86_64 archive", "i386 archive", "All supported archive"]
if not version or any(label not in parser.links for label in labels):
    # Print to stdout as well as stderr: the panel's update log shows
    # stdout, and a bare "Exit 1" with no reason is undiagnosable.
    print("ERROR: could not resolve the latest stable ET:Legacy engine and mod archives")
    sys.exit(1)
print(version.group(1))
for label in labels:
    print(parser.links[label])
`;

export const VINTAGE_STORY_RELEASE_PARSER = String.raw`
import sys, json, re
metadata = json.load(sys.stdin)
versions = [version for version, files in metadata.items()
            if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version)
            and files.get("linuxserver", {}).get("latest") == 1]
if len(versions) != 1:
    sys.exit("ERROR: could not resolve the latest stable Vintage Story Linux server")
print(versions[0])
`;

export function pythonCommand(source: string): string {
  return `python3 -c '${source.replace(/'/g, "'\\''")}'`;
}
