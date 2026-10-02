import { useEffect, useState } from "react"
import { Camera, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { validateEmployeePhoto } from "@/lib/employee-photo"

type Props = {
  file: File | null
  existingUrl?: string
  onFileChange: (file: File | null) => void
  onRemove: () => void
}

export function EmployeePhotoPicker({ file, existingUrl, onFileChange, onRemove }: Props) {
  const [preview, setPreview] = useState<string>()
  const [error, setError] = useState("")

  useEffect(() => {
    if (!file) {
      setPreview(undefined)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <div className="flex items-center gap-4 rounded-xl border bg-muted/30 p-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-secondary text-primary shadow-sm">
        {preview || existingUrl
          ? <img src={preview || existingUrl} alt="Personel profil fotoğrafı" className="h-full w-full object-cover object-center" />
          : <Camera className="h-6 w-6" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-semibold">Vesikalık / profil fotoğrafı</p>
        <p className="text-xs text-muted-foreground">İsteğe bağlı · JPG, PNG veya WebP · en fazla 5 MB</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">
            Fotoğraf seç
            <input
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Personel fotoğrafı seç"
              onChange={(event) => {
                const selected = event.target.files?.[0]
                if (!selected) return
                const validationError = validateEmployeePhoto(selected)
                setError(validationError || "")
                if (!validationError) onFileChange(selected)
                event.target.value = ""
              }}
            />
          </label>
          {(file || existingUrl) && <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => { onRemove(); setError("") }}><X className="h-3.5 w-3.5" /> Kaldır</Button>}
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}