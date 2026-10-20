import type { UpNextItem } from '../calendarLayout';

type Props = { items: UpNextItem[]; staleGeneratedAt: Date | null };

// The "Up next" rail beside the month grid: a scrollable agenda of upcoming
// events, each a date/time block and a title + optional meta line, with a
// left-edge accent tick colored by category. Shapes come from buildUpNext.
export function UpNext({ items, staleGeneratedAt }: Props) {
  return (
    <section className="card rail" aria-label="Up next">
      <div className="r-head">
        <span className="eyebrow">Up next</span>
      </div>
      <div className="r-list">
        {items.length === 0 ? (
          <p className="r-empty">No upcoming events.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.key}
              className={`up ${item.accent}${item.isToday ? ' is-today' : ''}`}
            >
              <div className="when">
                <span className="d">{item.dateLabel}</span>
                <span className="tm">{item.timeLabel}</span>
              </div>
              <div>
                <div className="ttl">{item.title}</div>
                {item.location && <div className="meta">{item.location}</div>}
              </div>
            </div>
          ))
        )}
        {staleGeneratedAt && (
          <p className="r-stale">
            As of{' '}
            {staleGeneratedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </div>
    </section>
  );
}
