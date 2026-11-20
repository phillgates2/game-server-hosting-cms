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
        self.title = ""
        self.text = []
        self.links = []
        self.page_text = []
    def handle_starttag(self, tag, attrs):
        if tag == "a":
            # File URLs may be assigned to href by JavaScript in the browser.
            attributes = dict(attrs)
            self.href = attributes.get("data-href") or attributes.get("href")
            self.title = attributes.get("title") or ""
            self.text = []
    def handle_data(self, data):
        self.page_text.append(data)
        if self.href is not None:
            self.text.append(data)
    def handle_endtag(self, tag):
        if tag == "a" and self.href is not None:
            label = " ".join("".join(self.text).split())
            url = urljoin("https://www.etlegacy.com/download", self.href)
            parsed = urlparse(url)
            if parsed.scheme == "https" and parsed.netloc == "www.etlegacy.com" and re.fullmatch(r"/download/file/[0-9]+", parsed.path):
                self.links.append((label, self.title.strip(), url))
            self.href = None

parser = Links()
parser.feed(sys.stdin.read())
version = re.search(r"\bstable\s+release\s+([0-9]+\.[0-9]+\.[0-9]+)\b", " ".join(parser.page_text), re.I)
labels = ["x86_64 archive", "i386 archive", "All supported archive"]
resolved = {}
if version:
    ver = version.group(1)
    # Newer download buttons use generic link text (and can be localized).
    # Match the exact stable archive, not an installer or another version.
    filenames = [f"etlegacy-v{ver}-x86_64.tar.gz", f"etlegacy-v{ver}-i386.tar.gz", f"etlegacy-mod-v{ver}.zip"]
    for label, filename in zip(labels, filenames):
        named = {url for text, title, url in parser.links if filename in (title, text)}
        # Older pages only expose architecture labels. Never use a labelled
        # link if it explicitly names a different ET:Legacy download.
        candidates = named or {url for text, title, url in parser.links
                               if text == label and not title.lower().startswith("etlegacy-")}
        if len(candidates) == 1:
            resolved[label] = candidates.pop()
missing = ([] if version else ["the stable release version"]) + [label for label in labels if label not in resolved]
if missing:
    # stderr, not stdout: the installer captures this parser's stdout in a
    # command substitution, so only stderr reaches the panel's error log.
    # A bare "Update failed (exit 1)" is undiagnosable.
    sys.exit("ERROR: could not resolve the latest stable ET:Legacy engine and mod archives from https://www.etlegacy.com/download (missing: " + ", ".join(missing) + ") - the page layout may have changed")
print(version.group(1))
for label in labels:
    print(resolved[label])
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
