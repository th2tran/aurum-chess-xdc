# Aurum Chess

Aurum Chess is a 3D chess mini-app originally created by Todd Smith, and packaged for [webxdc](https://webxdc.org/). Play a standard game of chess against the computer, share a device for pass-and-play, or play asynchronously with people in a chat. Other chat participants can watch a match. The board falls back to a 2D view on devices without WebGL support.

## How to play

Choose a mode from the main menu:

- **Play vs Computer** — choose Apprentice, Tactician, or Grandmaster, then choose White or Black.
- **Pass & Play** — take turns with another person on the same device. Enable **Auto-flip** in Settings if you want the board to turn toward the player whose turn it is.
- **Play over Chat** — open the mini-app in a webxdc-capable chat and take the White or Black seat. Moves are shared with the chat; anyone who does not take a seat can watch.

Select a piece and then its destination square, or drag the piece to its destination. Legal moves are enforced, and available moves can be shown with **Legal hints** in Settings. If a pawn reaches the far edge of the board, choose a queen, rook, bishop, or knight to promote it.

The usual chess rules apply: White moves first, players alternate turns, and the goal is to checkmate the opposing king. A game can also end in a draw, including stalemate. The status panel shows whose turn it is and the game result.

## Board controls

- **Moves** toggles the move list.
- **Flip** turns the board around.
- **Camera** switches the board view.
- **+ / −** zooms the view; you can also pinch on touch screens or scroll.
- Drag on the board background to orbit the 3D view.
- **Undo** is available in computer and pass-and-play games, but not chat games.
- **Resign** ends your game when you are seated in a chat match.
- **Settings** controls sound, legal hints, board coordinates, pass-and-play auto-flip, and graphics quality.

## Debug log

Aurum Chess includes a hidden debug log panel for troubleshooting. To open it, tap or click empty space outside the board seven times in a row, with less than a second between taps. Taps on the board, pieces, or buttons do not count. After the fourth tap, a message shows how many taps are left.

The panel opens on the right side of the screen. It shows the app version, whether the board uses the 3D or 2D view, the screen size, and a timestamped list of recent log entries. The list includes errors, chat updates, moves, and game events.

- Use the filter to show all entries, only info, debug, or error entries, or warnings together with errors.
- **Copy** copies the log and app details to the clipboard, for example to attach to a bug report.
- **Clear** empties the log.
- To close the panel, select **×**, press **Esc**, or tap empty space seven more times.

## Run locally

Install the development dependencies and start the webxdc development server:

```sh
npm install
npm start
```

To package the app as a webxdc file:

```sh
npm run build
```

The build creates a versioned `.xdc` package in `dist/`. The `build` script also increments the build number in `package.json`.
