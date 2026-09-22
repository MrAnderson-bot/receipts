import { money } from "@/lib/format";

export function DailyChart({ data }: { data: { day: string; value: number; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / data.length;
  return (
    <figure className="chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img"
        aria-label="Value of contracts published each day">
        {data.map((d, i) => {
          const h = (d.value / max) * 38;
          return (
            <rect key={d.day} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h}>
              <title>{`${d.day}: ${money(d.value)} across ${d.count} contracts`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption>
        <span>{data[0]?.day}</span>
        <span>Peak day {money(max)}</span>
        <span>{data.at(-1)?.day}</span>
      </figcaption>
    </figure>
  );
}
