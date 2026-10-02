const MAX_PHOTO_SIZE = 5 * 1024 * 1024
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export function validateEmployeePhoto(file: File): string | null {
  if (!PHOTO_TYPES.has(file.type)) return "JPG, PNG veya WebP fotoğraf seçin."
  if (file.size > MAX_PHOTO_SIZE) return "Fotoğraf 5 MB'tan küçük olmalı."
  return null
}

export function employeePhotoUrl(employeeId: number, photoPath: string | null | undefined): string | undefined {
  return photoPath ? `/api/storage/photos/${employeeId}?v=${encodeURIComponent(photoPath)}` : undefined
}

export async function uploadEmployeePhoto(file: File): Promise<string> {
  const error = validateEmployeePhoto(file)
  if (error) throw new Error(error)
  const response = await fetch("/api/storage/photos/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(result?.error || "Fotoğraf için yükleme izni alınamadı.")
  }
  const { uploadURL, objectPath } = await response.json() as { uploadURL: string; objectPath: string }
  const upload = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
  if (!upload.ok) throw new Error("Fotoğraf yüklenemedi. Tekrar deneyin.")
  return objectPath
}