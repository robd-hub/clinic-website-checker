export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          A free tool from{" "}
          <a
            href="https://designimp.com"
            className="text-foreground underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold"
          >
            Design Imp
          </a>
        </p>
        <p className="flex items-center gap-4">
          <a href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </a>
          <span>© 2026 Design Imp</span>
        </p>
      </div>
    </footer>
  );
}
