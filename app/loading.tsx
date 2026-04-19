export default function Loading() {
  return (
    <div className="container-core py-10 space-y-4">
      <div className="skeleton h-6 w-48" />
      <div className="skeleton h-14 w-2/3" />
      <div className="skeleton h-24 w-full" />
      <div className="skeleton h-60 w-full" />
    </div>
  );
}
