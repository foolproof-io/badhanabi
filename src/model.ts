export type PlayerId = string;

export type Color = string;
export type Rank = string;
export type Tile = string;
export type Hint = string;
export const COLORS: Color[] = ["R", "G", "B", "Y", "W", "P"];
export const RANKS: Rank[] = ["1", "2", "3", "4", "5"];
export const UNKNOWN: Tile = "UU";

export interface HandItem {
  // If it is a tile
  tile?: Tile;
  hints?: Hint[];
  // If it is a hint marker
  hint?: Hint;
}
export type Hand = HandItem[];

export interface Model {
  uid?: PlayerId;
  helptext?: string;
  room?: WaitingArea | Game;
  actions?: LoggedAction[];
}

export interface WaitingArea {
  tag: "waiting_area";
  viewers: PlayerId[];
  names: { [id: string]: string };
}

export interface Game {
  tag: "game";
  viewers: PlayerId[];
  names: { [id: string]: string };
  turn: PlayerId;
  players: PlayerId[];
  draw_pile: Tile[];
  play_pile: Tile[];
  discard_pile: Tile[];
  hints: number;
  errors: number;
  hands: { [id: string]: Hand };
}

export interface LoggedAction {
  text: string;
}

export interface Controller {
  onTextInput(evt: any): void;
}
