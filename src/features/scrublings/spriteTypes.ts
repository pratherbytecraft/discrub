/** A Scrubling's pixel art: one character per pixel, 20 wide by 28 tall, rows trimmed of trailing blanks. */
export interface SpriteSheet {
  id: string;
  /** Grid character to CSS color. Blank ('.') pixels are absent. */
  palette: Record<string, string>;
  frames: Record<string, string[]>;
  /** Activity name to the frames it cycles through, in order. */
  activities: Record<string, string[]>;
}

export const SPRITE_W = 20;
export const SPRITE_H = 28;
/** Rows of headroom above the art; the feet stand on row 23 and rows 24 and 25 hang below the ledge. */
export const SPRITE_FEET_ROW = 26;
