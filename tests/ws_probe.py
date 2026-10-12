#!/usr/bin/env python3
"""Client WebSocket minimal pour ttyd (bibliothèque standard uniquement).

Exécuté dans le container par les tests de fumée :
    python3 - <url> <jeton|-> <origine|-> [commande] < ws_probe.py

Affiche le statut HTTP de la poignée de main sur la première ligne
(« HTTP 101 », « HTTP 401 »…), puis, si la connexion est établie et qu'une
commande est fournie, la sortie du terminal après l'envoi de cette commande.
"""
import base64
import json
import os
import socket
import sys
import time
from urllib.parse import urlparse


def frame(payload: bytes, opcode: int = 0x2) -> bytes:
    """Trame client (masquée) ; opcode 2 = binaire, 8 = fermeture."""
    mask = os.urandom(4)
    header = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header += bytes([0x80 | n])
    elif n < 65536:
        header += bytes([0x80 | 126]) + n.to_bytes(2, "big")
    else:
        header += bytes([0x80 | 127]) + n.to_bytes(8, "big")
    return header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))


def read_frames(sock: socket.socket, buf: bytearray, seconds: float) -> bytes:
    """Lit les trames serveur pendant `seconds` et renvoie la sortie du terminal."""
    out = bytearray()
    deadline = time.time() + seconds
    while time.time() < deadline:
        sock.settimeout(max(0.05, deadline - time.time()))
        try:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf.extend(chunk)
        except socket.timeout:
            pass
        while len(buf) >= 2:
            n = buf[1] & 0x7F
            pos = 2
            if n == 126:
                if len(buf) < 4:
                    break
                n, pos = int.from_bytes(buf[2:4], "big"), 4
            elif n == 127:
                if len(buf) < 10:
                    break
                n, pos = int.from_bytes(buf[2:10], "big"), 10
            if len(buf) < pos + n:
                break
            payload = bytes(buf[pos:pos + n])
            del buf[:pos + n]
            # ttyd : « 0 » = sortie du terminal
            if payload[:1] == b"0":
                out.extend(payload[1:])
    return bytes(out)


def main() -> int:
    url, token, origin = sys.argv[1], sys.argv[2], sys.argv[3]
    command = sys.argv[4] if len(sys.argv) > 4 else None
    u = urlparse(url)
    host, port = u.hostname, u.port or 80

    sock = socket.create_connection((host, port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    lines = [
        f"GET {u.path} HTTP/1.1",
        f"Host: {host}:{port}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Protocol: tty",
    ]
    if origin != "-":
        lines.append(f"Origin: {origin}")
    if token != "-":
        lines.append(f"Authorization: Bearer {token}")
    sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())

    buf = bytearray()
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            break
        buf.extend(chunk)
    head, _, rest = bytes(buf).partition(b"\r\n\r\n")
    status = head.split(b"\r\n", 1)[0].decode(errors="replace").split(" ")
    code = status[1] if len(status) > 1 else "???"
    print(f"HTTP {code}")
    if code != "101" or command is None:
        return 0

    buf = bytearray(rest)
    # Message d'initialisation attendu par ttyd avant de lancer le processus
    sock.sendall(frame(json.dumps({"AuthToken": "", "columns": 120, "rows": 30}).encode()))
    read_frames(sock, buf, 8)                     # bannière et prompt
    sock.sendall(frame(b"0" + command.encode() + b"\r"))
    output = read_frames(sock, buf, 6)
    sock.sendall(frame(b"", opcode=0x8))
    sock.close()
    sys.stdout.write(output.decode(errors="replace"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
