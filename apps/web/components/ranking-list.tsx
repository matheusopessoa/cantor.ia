import { DIFFICULTY_LABEL } from "@/lib/difficulty";
import { formatOrdinal, formatScore } from "@/lib/format";
import type { Difficulty, RankingItem } from "@/lib/types";

interface RankingListProps {
  items: RankingItem[];
  /** Nível deste ranking (sdd-009): rankings são por música e nível, e o título diz qual. */
  difficulty: Difficulty;
  /** Performance a destacar (`tr.is-you`). */
  highlightId?: string | null;
}

/** HIGH SCORES de fliperama: `.ct-marquee` + `.ct-ranking`. */
export function RankingList({ items, difficulty, highlightId = null }: RankingListProps) {
  return (
    <div className="ct-marquee">
      <table className="ct-ranking">
        <caption>High scores · {DIFFICULTY_LABEL[difficulty]}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Nome</th>
            <th scope="col">Nota</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3} className="text-center normal-case tracking-normal">
                Ninguém cantou ainda. Seja a primeira pessoa no ranking.
              </td>
            </tr>
          ) : (
            items.map((item, index) => (
              <tr key={item.id} className={item.id === highlightId ? "is-you" : undefined}>
                <td>{formatOrdinal(index + 1)}</td>
                <td>{item.playerName}</td>
                <td>{formatScore(item.score)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
