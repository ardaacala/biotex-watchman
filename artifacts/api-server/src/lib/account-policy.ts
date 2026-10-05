type Member = { id: number; role: string; approvalStatus: string };

export function isApprovedManager(member: { role: string; approvalStatus: string } | undefined): boolean {
  return member?.role === "manager" && member.approvalStatus === "approved";
}

export function accountChangeError(
  actorId: number,
  target: Member,
  approvedManagerCount: number,
  action: "delete" | "role",
  nextRole?: string,
): string | null {
  if (target.id === actorId && (action === "delete" || nextRole !== "manager")) {
    return action === "delete"
      ? "Kendi hesabınızı bu panelden silemezsiniz."
      : "Kendi yönetici yetkinizi kaldıramazsınız.";
  }
  if (isApprovedManager(target) && approvedManagerCount <= 1 && (action === "delete" || nextRole !== "manager")) {
    return "Son onaylı yönetici hesabı silinemez veya İK yetkisine geçirilemez.";
  }
  return null;
}
