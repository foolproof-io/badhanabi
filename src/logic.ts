import _ from "lodash";
import { strictParse } from "./util";
import { Tile, Hint, COLORS, Hand, Color, Rank, RANKS } from "./model";

export function generateDeck(): Tile[] {
  let tiles: Tile[] = [];
  for (let c of COLORS) {
    for (let r of RANKS) {
      for (let i = 0; i < numTiles(r); i++) {
        tiles.push(`${c}${r}`);
      }
    }
  }
  return _.shuffle(tiles);
}

function numTiles(rank: Rank): number {
  switch (rank) {
    case "1":
      return 3;
    case "2":
    case "3":
    case "4":
      return 2;
    case "5":
      return 1;
    default:
      return 0;
  }
}

export function handSize(num_players: number): number {
  switch (num_players) {
    case 2:
      return 6;
    case 3:
      return 5;
    case 4:
      return 4;
    case 5:
      return 4;
    default:
      return -1;
  }
}
export const NUM_INITIAL_HINTS = 8;
export function drawTiles(tiles: Tile[], num_tiles: number): Hand {
  let ts: Hand = [];
  for (let i = 0; i < num_tiles; i++) {
    ts.push({ tile: tiles.pop(), hints: [] });
  }
  return ts;
}

export function summarizePlayPile(play_pile: Tile[]): Map<Color, number> {
  let highest_by_color = new Map<Color, number>();
  for (let tile of play_pile) {
    const c = tile[0];
    const r = strictParse(tile[1]);
    highest_by_color.set(c, Math.max(highest_by_color.get(c) || 0, r));
  }
  return highest_by_color;
}
export function isLegalPlay(play_pile: Tile[], tile: Tile): boolean {
  const summary = summarizePlayPile(play_pile);
  const c = tile[0];
  const r = strictParse(tile[1]);
  return r === (summary.get(c) || 0) + 1;
}
export function applyHintToHand(hand: Hand, hint: Hint): Hand {
  let applied = hand.map(item => {
    if (item.tile && item.hints && matchesHint(item.tile, hint)) {
      item.hints.push(hint);
    }
    return item;
  });
  applied.push({ hint });
  return applied;
}

export function removeCardFromHand(hand: Hand, idx: number): Hand {
  let minus_card = hand.slice(0, idx).concat(hand.slice(idx + 1));
  // trim off any leading hints, they give no information
  while (minus_card.length > 0 && minus_card[0].hint) {
    minus_card.shift();
  }
  return minus_card;
}

export function matchesHint(tile: Tile, hint: Hint): boolean {
  return tile.indexOf(hint) !== -1;
}
