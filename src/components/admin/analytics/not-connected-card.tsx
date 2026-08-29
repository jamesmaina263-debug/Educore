export function NotConnectedCard({ title, instructions }: { title: string; instructions: string[] }) {
  return (
    <div className="panel flex flex-col gap-2 p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">Not connected yet — nothing below is fabricated data.</p>
      <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        {instructions.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
