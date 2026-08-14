import { CELL_COUNT, FREE_INDEX, GRID_SIZE } from "@/lib/patterns";

interface Props {
  map: string;
  /** Pixel size of the whole grid. */
  size?: number;
}

/** Tiny 5x5 rendering of a PatternMap, for use inside the pattern list. */
export default function MiniPattern({ map, size = 44 }: Props) {
  const cells = Array.from({ length: CELL_COUNT }, (_, i) => {
    const ch = map[i] ?? "0";
    const marked = ch === "1" || ch === "2";
    const isFree = i === FREE_INDEX;
    return { i, marked, isFree };
  });

  return (
    <div
      className="mini-pattern"
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
      }}
      aria-hidden="true"
    >
      {cells.map((c) => (
        <span
          key={c.i}
          className={
            "mini-cell" +
            (c.marked ? " marked" : "") +
            (c.isFree && c.marked ? " free" : "")
          }
        />
      ))}
    </div>
  );
}
