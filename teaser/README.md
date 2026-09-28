# Scoutflo teaser (25 s loop, 1440×1440, 60 fps)

`scoutflo-teaser.mp4` is the rendered loop and `beats_sheet.png` shows one frame per beat.

- `index.html`: the animation. Every style is computed inside `seek(t)` from closed-form springs, one spring per target change, and the previous loop cycle's springs are summed too, so t=25 ≡ t=0 in both position and velocity. Open it with `?play` to preview in real time, or `?t=6.8` to hold one frame.
- `audio/make_song.py`: an original 96 BPM, 10-bar track (royalty-free by construction).
- `audio/analyze.py`: measures the beat grid with numpy (tempo, phase, downbeat) and cuts the 40-beat loop, starting on a downbeat.
- `audio/mix.py`: synthesizes the UI sounds and places each one so its measured peak lands on its cue.
- `render/render.js`: the Playwright renderer (4 subframes per frame, blended with ffmpeg `tmix`), plus the one-frame-per-beat check.
- `./build.sh` runs the whole pipeline. `SONG=track.mp3 AT=12 ./build.sh` uses any ~96 BPM song instead; `AT` is the approximate loop start in seconds.

Fonts: Geist and Geist Mono (SIL OFL, `fonts/OFL.txt`).
