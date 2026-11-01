#!/usr/bin/env bash
# Creates the test videos/images used by the automated tests (needs ffmpeg).
# They are generated, not stored in git, because one is 50 MB.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fixtures
cd fixtures

# ~50 MB WebM (noisy picture so it can't compress small).
[ -f big-50mb.webm ] || ffmpeg -y -loglevel error -f lavfi -i "testsrc2=s=1920x1080:r=30:d=10,noise=alls=40:allf=t" \
  -c:v libvpx -deadline realtime -cpu-used 8 -b:v 42M -minrate 42M -maxrate 42M -bufsize 8M -an big-50mb.webm

# Square video (1:1) to check cropping with a very different shape.
[ -f square.webm ] || ffmpeg -y -loglevel error -f lavfi -i "testsrc2=s=720x720:r=24:d=3" -c:v libvpx -b:v 1M -an square.webm

# Small animated GIF.
[ -f anim.gif ] || ffmpeg -y -loglevel error -f lavfi -i "testsrc2=s=480x270:r=10:d=2" -vf "split[a][b];[a]palettegen[p];[b][p]paletteuse" anim.gif

ls -la
