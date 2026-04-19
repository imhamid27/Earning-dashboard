// Small reusable empty-state block. Use the cta prop to guide the user to the
// fix (e.g. "run ingestion" when the DB is empty).
export default function EmptyState({
  title,
  message,
  cta
}: {
  title: string;
  message?: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="card p-8 text-center">
      <div className="serif text-xl mb-1">{title}</div>
      {message ? <div className="text-sm text-core-muted max-w-md mx-auto">{message}</div> : null}
      {cta ? <div className="mt-4">{cta}</div> : null}
    </div>
  );
}
