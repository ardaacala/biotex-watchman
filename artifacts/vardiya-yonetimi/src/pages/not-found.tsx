import { Link } from "wouter"
import { Factory } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground space-y-6">
      <div className="flex items-center justify-center h-24 w-24 rounded-full bg-muted text-muted-foreground mb-4">
        <Factory className="h-12 w-12" />
      </div>
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">404</h1>
        <p className="text-xl text-muted-foreground">Sayfa bulunamadı</p>
      </div>
      <Link href="/" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 mt-4">
        Kontrol Paneline Dön
      </Link>
    </div>
  )
}
