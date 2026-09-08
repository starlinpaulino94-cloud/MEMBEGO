export function RetailEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <section className="bg-background px-4 py-5 md:px-6 md:py-6">
      <div className="mx-auto max-w-6xl rounded-lg border border-border bg-muted p-4 text-center">
        <h2 className="text-h4 text-foreground">{title}</h2>
        <p className="mt-1 text-small text-muted-foreground">{description}</p>
      </div>
    </section>
  )
}
