"""Download the IndicConformer speech-to-text model into ./models (run once).

    uv run python download_model.py

Needs HF_TOKEN in .env: the model is free (MIT) but Hugging Face asks you to
log in and accept its terms once before downloading.
"""

import os
import socket

from dotenv import load_dotenv
from huggingface_hub import snapshot_download

# Some Indian ISPs block huggingface.co over IPv6 (the connection is reset)
# while IPv4 works fine. Only hand out IPv4 addresses so the download goes
# through the route that isn't blocked.
_original_getaddrinfo = socket.getaddrinfo


def _ipv4_only(host, port, family=0, *args, **kwargs):
    return _original_getaddrinfo(host, port, socket.AF_INET, *args, **kwargs)


socket.getaddrinfo = _ipv4_only

load_dotenv()
path = snapshot_download(
    repo_id="ai4bharat/indic-conformer-600m-multilingual",
    local_dir=os.path.join(os.path.dirname(__file__), "models", "indic-conformer"),
    token=os.environ["HF_TOKEN"],
)
print("Downloaded to", path)
