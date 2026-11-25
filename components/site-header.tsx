export function SiteHeader() {
  return (
    <header className="border-b border-border/80">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
        <a
          href="https://designimp.com"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          designimp.com
        </a>
        <p className="text-sm text-muted-foreground">Clinic check</p>
      </div>
    </header>
  );
}
