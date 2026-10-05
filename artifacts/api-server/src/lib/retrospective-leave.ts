type ExistingLeave = {
  startDate: string;
  endDate: string;
  status: string;
};

export function retrospectiveDateError(startDate: string, endDate: string, today: string): string | null {
  if (startDate > endDate) return "Bitiş tarihi başlangıçtan önce olamaz.";
  if (startDate.slice(0, 4) !== today.slice(0, 4) || endDate.slice(0, 4) !== today.slice(0, 4)) {
    return "Geçmiş izin kaydı yalnızca içinde bulunduğumuz takvim yılı için eklenebilir.";
  }
  if (endDate >= today) return "Geçmiş izin kaydının bitiş tarihi bugünden önce olmalıdır.";
  return null;
}

export function hasBookedOverlap(leaves: ExistingLeave[], startDate: string, endDate: string): boolean {
  return leaves.some(leave => leave.status !== "rejected" && leave.startDate <= endDate && leave.endDate >= startDate);
}
