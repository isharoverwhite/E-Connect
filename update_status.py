import re

with open("PROJECT_STATUS.md", "r") as f:
    text = f.read()

text = re.sub(
    r"## Current Phase:.*",
    "## Current Phase: Test",
    text
)

text = re.sub(
    r"- \[ \] G3.*",
    "- [x] G3 Implementation complete",
    text
)

with open("PROJECT_STATUS.md", "w") as f:
    f.write(text)
