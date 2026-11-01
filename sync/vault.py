"""Chiffrement des fichiers du dashboard (data.bin, et la progression de révision).

Format : « PDB1 » + itérations (4 octets) + sel (16) + IV (12) + JSON gzippé chiffré en AES-256-GCM.
Le navigateur dérive la même clé à partir du mot de passe (PBKDF2-SHA256).
"""

import gzip
import json
import os
import struct

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_keys: dict[tuple, bytes] = {}


def _key(password: str, salt: bytes, iterations: int) -> bytes:
    cache_key = (password, salt, iterations)
    if cache_key not in _keys:
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
        _keys[cache_key] = kdf.derive(password.encode())
    return _keys[cache_key]


def encrypt(payload: bytes, password: str, salt: bytes, iterations: int) -> bytes:
    iv = os.urandom(12)
    key = _key(password, salt, iterations)
    return b"PDB1" + struct.pack(">I", iterations) + salt + iv + AESGCM(key).encrypt(iv, payload, None)


def decrypt(blob: bytes, password: str) -> bytes:
    if blob[:4] != b"PDB1":
        raise ValueError("format inconnu")
    iterations = struct.unpack(">I", blob[4:8])[0]
    salt, iv = blob[8:24], blob[24:36]
    return AESGCM(_key(password, salt, iterations)).decrypt(iv, blob[36:], None)


def seal(obj, password: str, salt: bytes, iterations: int) -> bytes:
    raw = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    return encrypt(raw, password, salt, iterations)


def unseal(blob: bytes, password: str):
    return json.loads(gzip.decompress(decrypt(blob, password)).decode("utf-8"))
