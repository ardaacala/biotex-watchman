import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Layout } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useToast } from "@/hooks/use-toast"
import { 
  useListDepartments, 
  useCreateDepartment, 
  useRenameDepartment, 
  useDeleteDepartment, 
  getListDepartmentsQueryKey,
  getListEmployeesQueryKey,
  getListDepartmentSchedulesQueryKey,
  getListSpecialPeriodsQueryKey,
  getGetDashboardSummaryQueryKey,
  Department
} from "@workspace/api-client-react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Search, Plus, Edit2, Trash2, Building2, AlertTriangle, Users } from "lucide-react"

const departmentSchema = z.object({
  name: z.string().min(2, "Departman adı en az 2 karakter olmalıdır").max(100, "Departman adı en fazla 100 karakter olabilir"),
  annualLeaveDays: z.coerce.number().min(0, "İzin hakkı negatif olamaz").max(100, "İzin hakkı en fazla 100 gün olabilir"),
})

type DepartmentFormValues = z.infer<typeof departmentSchema>

export default function DepartmentsPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editDepartment, setEditDepartment] = useState<Department | null>(null)
  const [deleteDepartment, setDeleteDepartment] = useState<Department | null>(null)
  
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const { data: departments = [], isLoading } = useListDepartments()
  
  const createMutation = useCreateDepartment()
  const renameMutation = useRenameDepartment()
  const deleteMutation = useDeleteDepartment()

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", annualLeaveDays: 14 }
  })

  const editForm = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
  })

  const openEdit = (dept: Department) => {
    editForm.reset({ name: dept.name, annualLeaveDays: dept.annualLeaveDays })
    setEditDepartment(dept)
  }

  const invalidateRelated = () => {
    queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListDepartmentSchedulesQueryKey() })
    queryClient.invalidateQueries({ queryKey: getListSpecialPeriodsQueryKey() })
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })
    queryClient.invalidateQueries({ predicate: query => Array.isArray(query.queryKey) && typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/daily-work-records') })
  }

  const onSubmitCreate = (data: DepartmentFormValues) => {
    createMutation.mutate({ data: { name: data.name, annualLeaveDays: data.annualLeaveDays } }, {
      onSuccess: () => {
        invalidateRelated()
        setIsCreateOpen(false)
        form.reset()
        toast({ title: "Başarılı", description: "Departman eklendi." })
      },
      onError: (err: any) => {
        toast({ title: "Hata", description: err.message || "Departman eklenemedi.", variant: "destructive" })
      }
    })
  }

  const onSubmitEdit = (data: DepartmentFormValues) => {
    if (!editDepartment) return
    renameMutation.mutate({ 
      id: editDepartment.id, 
        data: { name: data.name, annualLeaveDays: data.annualLeaveDays }
    }, {
      onSuccess: () => {
        invalidateRelated()
        setEditDepartment(null)
        toast({ title: "Başarılı", description: "Departman adı güncellendi." })
      },
      onError: (err: any) => {
        toast({ title: "Hata", description: err.message || "Departman güncellenemedi.", variant: "destructive" })
      }
    })
  }
  
  const onConfirmDelete = () => {
    if (!deleteDepartment) return
    deleteMutation.mutate({ id: deleteDepartment.id }, {
      onSuccess: () => {
        invalidateRelated()
        setDeleteDepartment(null)
        toast({ title: "Başarılı", description: "Departman silindi." })
      },
      onError: (err: any) => {
        toast({ title: "Hata", description: err.message || "Departman silinemedi.", variant: "destructive" })
      }
    })
  }

  const filteredDepartments = departments.filter(d => 
    d.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <Layout>
      <div className="flex-1 overflow-auto p-8 flex flex-col">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Departmanlar</h1>
            <p className="text-muted-foreground mt-1">{departments.length} kayıtlı departman</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Yeni Departman</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Yeni Departman Ekle</DialogTitle>
                <DialogDescription>Sisteme yeni bir departman ekleyin.</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitCreate)} className="space-y-4 mt-2">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Departman Adı</FormLabel>
                      <FormControl><Input placeholder="Örn: Üretim" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                <FormField control={form.control} name="annualLeaveDays" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Yıllık İzin Hakkı (Gün)</FormLabel>
                    <FormControl><Input type="number" min={0} max={100} data-testid="input-department-annual-leave" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                  <DialogFooter className="pt-4">
                    <Button type="submit" disabled={createMutation.isPending}>Kaydet</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex-1 flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-card/50">
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Departman ara..."
                className="pl-9 bg-background"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                <TableRow>
                  <TableHead className="w-[80px]">ID</TableHead>
                  <TableHead>Departman</TableHead>
                  <TableHead className="text-right">Yıllık İzin Hakkı</TableHead>
                  <TableHead className="text-right">Personel Sayısı</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8">Yükleniyor...</TableCell></TableRow>
                ) : filteredDepartments.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Kayıt bulunamadı</TableCell></TableRow>
                ) : (
                  filteredDepartments.map((dept) => (
                    <TableRow key={dept.id}>
                      <TableCell className="font-mono text-xs font-medium text-muted-foreground">{dept.id}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <span className="font-medium text-foreground">{dept.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{dept.annualLeaveDays} gün</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5 font-medium">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          {dept.employeeCount}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(dept)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteDepartment(dept)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <Dialog open={!!editDepartment} onOpenChange={(open) => !open && setEditDepartment(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Departman Düzenle</DialogTitle>
              <DialogDescription>Departman adı değişirse bağlı personel ve planlar güncellenir. Yıllık izin hakkı değişirse kişisel hakkı olmayan personele yeni miktar uygulanır.</DialogDescription>
            </DialogHeader>
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="space-y-4 mt-2">
                <FormField control={editForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departman Adı</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="annualLeaveDays" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Yıllık İzin Hakkı (Gün)</FormLabel>
                    <FormControl><Input type="number" min={0} max={100} data-testid="input-edit-department-annual-leave" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <DialogFooter className="pt-4">
                  <Button type="button" variant="ghost" onClick={() => setEditDepartment(null)}>İptal</Button>
                  <Button type="submit" disabled={renameMutation.isPending}>Güncelle</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteDepartment} onOpenChange={(open) => !open && setDeleteDepartment(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Departmanı Sil
              </DialogTitle>
              <DialogDescription className="text-base pt-2 text-foreground">
                <span className="font-bold">{deleteDepartment?.name}</span> departmanını silmek üzeresiniz.
              </DialogDescription>
            </DialogHeader>
            
            {deleteDepartment?.employeeCount && deleteDepartment.employeeCount > 0 ? (
              <div className="bg-destructive/10 border-destructive/20 border text-destructive text-sm p-4 rounded-lg flex gap-3 mt-2">
                <Users className="h-5 w-5 shrink-0" />
                <p>Bu departmanda <strong>{deleteDepartment.employeeCount} personel</strong> bulunmaktadır. Departmanı silebilmek için öncelikle bu personelleri başka bir departmana taşımalı veya sistemden kaldırmalısınız.</p>
              </div>
            ) : (
              <div className="bg-amber-50 border-amber-200 border text-amber-900 text-sm p-4 rounded-lg flex gap-3 mt-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                <p>Bu işlem geri alınamaz. Departmanla birlikte tanımlanmış <strong>vardiya planları ve özel çalışma dönemleri de kalıcı olarak silinecektir.</strong></p>
              </div>
            )}

            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setDeleteDepartment(null)}>İptal</Button>
              <Button 
                type="button" 
                variant="destructive" 
                disabled={deleteMutation.isPending || (deleteDepartment?.employeeCount ?? 0) > 0} 
                onClick={onConfirmDelete}
              >
                {deleteMutation.isPending ? "Siliniyor..." : "Evet, Sil"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  )
}
