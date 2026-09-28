#!/usr/bin/env bash
# Full pipeline: song -> beat grid -> cues -> SFX mix -> beat check -> render -> encode.
#   ./build.sh                 synthesize the original track
#   SONG=path/to/song.mp3 AT=12 ./build.sh   use any ~96 BPM song; AT = approx loop start (s), BEATS = loop length
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
pip install -q numpy scipy soundfile imageio-ffmpeg >/dev/null 2>&1 || true
FF=$(python3 -c "import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())")

if [[ -n "${SONG:-}" ]]; then
  "$FF" -y -loglevel error -i "$SONG" -ar 48000 -ac 2 build/song.wav
else
  python3 audio/make_song.py build/song.wav
fi
python3 audio/analyze.py build/song.wav --at "${AT:-25}" --beats "${BEATS:-40}" --out-wav build/loop.wav --out-json build/grid.json
node render/render.js cues
python3 audio/mix.py build/loop.wav build/cues.json build/mix.wav | tail -1
node render/render.js beats            # build/beats_sheet.png: one frame per beat
node render/render.js full "${WORKERS:-4}"
"$FF" -y -loglevel error -i build/video.mkv -i build/mix.wav \
  -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -profile:v high -r 60 \
  -c:a aac -b:a 256k -shortest -movflags +faststart scoutflo-teaser.mp4
echo "wrote scoutflo-teaser.mp4"
