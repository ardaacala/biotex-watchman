import { format } from "date-fns"
import { tr } from "date-fns/locale"
import { Check, Loader2, UserCheck, UserRound, X } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import {
  getListMembershipRequestsQueryKey,
  useListMembershipRequests,
  useReviewMembershipRequest,
} from "@workspace/api-client-react"
import { Layout } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

export default function MembershipRequestsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: requests = [], isLoading, isError } = useListMembershipRequests({
    query: { queryKey: getListMembershipRequestsQueryKey(), refetchInterval: 30_000 },
  })
  const review = useReviewMembershipRequest()

  function handleReview(id: number, approvalStatus: "approved" | "rejected") {
    review.mutate({ id, data: { approvalStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembershipRequestsQueryKey() })
        toast({
          title: approvalStatus === "approved" ? "Üyelik onaylandı" : "Üyelik reddedildi",
          description: approvalStatus === "approved"
            ? "Kullanıcı artık sisteme giriş yapabilir."
            : "Başvuru onay listesinden kaldırıldı.",
        })
      },
      onError: (error) => {
        toast({
          title: "İşlem tamamlanamadı",
          description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
          variant: "destructive",
        })
      },
    })
  }

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-7">
            <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
              <UserCheck className="h-7 w-7 text-primary" />
              Onay Bekleyen Üyelikler
            </h1>
            <p className="mt-2 text-muted-foreground">
              Yeni İK kullanıcılarının sisteme erişim başvurularını değerlendirin.
            </p>
          </div>

          {isLoading ? (
            <div className="flex h-48 items-center justify-center rounded-xl border bg-card">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center font-medium text-destructive">
              Üyelik başvuruları yüklenemedi.
            </div>
          ) : requests.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed bg-card/60 p-10 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserCheck className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-bold">Bekleyen üyelik bulunmuyor</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Yeni bir kullanıcı üyelik başvurusu yaptığında burada görünecek.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((request) => (
                <div key={request.id} className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5 shadow-sm">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-52 flex-1">
                    <p className="font-bold text-foreground">{request.displayName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">@{request.username}</p>
                  </div>
                  <div className="min-w-40 text-sm">
                    <p className="font-medium text-foreground">Başvuru tarihi</p>
                    <p className="mt-1 text-muted-foreground">
                      {format(new Date(request.createdAt), "d MMMM yyyy, HH:mm", { locale: tr })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={review.isPending}
                      onClick={() => handleReview(request.id, "rejected")}
                    >
                      <X className="mr-2 h-4 w-4" /> Reddet
                    </Button>
                    <Button disabled={review.isPending} onClick={() => handleReview(request.id, "approved")}>
                      <Check className="mr-2 h-4 w-4" /> Onayla
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}