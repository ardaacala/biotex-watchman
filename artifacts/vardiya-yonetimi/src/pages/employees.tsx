import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Layout } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { EmployeePhotoPicker } from "@/components/employee-photo-picker"
import { employeePhotoUrl, uploadEmployeePhoto } from "@/lib/employee-photo"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useListEmployees, useListDepartments, useCreateEmployee, useUpdateEmployee, useDeleteEmployee, getListEmployeesQueryKey, Employee } from "@workspace/api-client-react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Search, Plus, Edit2, ShieldAlert, CalendarClock, Trash2 } from "lucide-react"
import { useLocation, Link } from "wouter"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/auth"

const getIstanbulToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

const numberFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 })
const formatLeaveHours = (hours: number) => `${numberFormat.format(hours)} saat (${numberFormat.format(hours / 9)} gün)`

const employeeSchema = z.object({
  employeeNumber: z.string().min(1, "Sicil no gerekli"),
  name: z.string().min(2, "Ad soyad gerekli"),
  department: z.string().min(1, "Departman gerekli"),
  role: z.string().min(2, "Görev gerekli"),
  hireDate: z.string().min(1, "İşe giriş tarihi gerekli")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Geçerli bir tarih seçin")
    .refine((date) => date <= getIstanbulToday(), "İşe giriş tarihi bugün veya geçmiş bir tarih olmalı"),
  annualLeaveDaysOverride: z.string().refine((value) => {
    if (value === "") return true
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return false
    const days = Number(value)
    return days >= 0 && days <= 100
  }, "İzin hakkı 0 ile 100 gün arasında olmalı"),
})

type EmployeeFormInput = z.input<typeof employeeSchema>
type EmployeeFormValues = z.output<typeof employeeSchema>

export default function EmployeesPage() {
  const [, setLocation] = useLocation()
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState("")
  const [sortBy, setSortBy] = useState<"alphabetical" | "department" | "status">("alphabetical")
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createHireDateMode, setCreateHireDateMode] = useState<"today" | "past">("today")
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null)
  const [createPhoto, setCreatePhoto] = useState<File | null>(null)
  const [editPhoto, setEditPhoto] = useState<File | null>(null)
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false)
  const [savingPhoto, setSavingPhoto] = useState(false)

  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: employees = [], isLoading } = useListEmployees()
  const { data: departments = [] } = useListDepartments()

  const createMutation = useCreateEmployee()
  const updateMutation = useUpdateEmployee()
  const deleteMutation = useDeleteEmployee()

  const form = useForm<EmployeeFormInput, unknown, EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeNumber: "",
      name: "",
      department: "",
      role: "",
      hireDate: getIstanbulToday(),
      annualLeaveDaysOverride: "",
    },
  })

  const editForm = useForm<EmployeeFormInput, unknown, EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeNumber: "",
      name: "",
      department: "",
      role: "",
      hireDate: "",
      annualLeaveDaysOverride: "",
    },
  })

  const createDepartment = form.watch("department")
  const createOverride = form.watch("annualLeaveDaysOverride")
  const editDepartment = editForm.watch("department")
  const editOverride = editForm.watch("annualLeaveDaysOverride")

  const invalidateRelatedViews = () => {
    void queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() })
    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) => [
        "/employees",
        "/daily-work-records",
        "/leaves",
        "/work-debts",
        "/work-history/",
        "/dashboard/summary",
      ].some((path) => JSON.stringify(queryKey).includes(path)),
    })
  }

  const quotaPreview = (departmentName: string, override: string | number | null | undefined) => {
    const department = departments.find((item) => item.name === departmentName)
    const hasOverride = override !== "" && override !== null && override !== undefined
    return (
      <p className="text-xs text-muted-foreground">
        {hasOverride
          ? `Personel özel hakkı: ${numberFormat.format(Number(override))} gün · ${formatLeaveHours(Number(override) * 9)}`
          : department
            ? `Departman hakkı: ${department.annualLeaveDays} gün · ${formatLeaveHours(department.annualLeaveDays * 9)} (miras alınır)`
            : "Departman seçildiğinde departman hakkı burada gösterilir."}
      </p>
    )
  }

  const openEdit = (employee: Employee) => {
    editForm.reset({
      employeeNumber: employee.employeeNumber,
      name: employee.name,
      department: employee.department,
      role: employee.role,
      hireDate: employee.hireDate?.slice(0, 10) ?? "",
      annualLeaveDaysOverride: employee.annualLeaveDaysOverride === null ? "" : String(employee.annualLeaveDaysOverride),
    })
    setEditPhoto(null)
    setEditPhotoRemoved(false)
    setEditEmployee(employee)
  }

  const onSubmitCreate = async (data: EmployeeFormValues) => {
    try {
      setSavingPhoto(true)
      const photoPath = createPhoto ? await uploadEmployeePhoto(createPhoto) : undefined
      await createMutation.mutateAsync({
        data: {
        employeeNumber: data.employeeNumber,
        name: data.name,
        department: data.department,
        role: data.role,
        hireDate: data.hireDate,
        annualLeaveDaysOverride: data.annualLeaveDaysOverride === "" ? null : Number(data.annualLeaveDaysOverride),
        ...(photoPath ? { photoPath } : {}),
        },
      })
      invalidateRelatedViews()
      setIsCreateOpen(false)
      setCreatePhoto(null)
      setCreateHireDateMode("today")
      form.reset({
        employeeNumber: "",
        name: "",
        department: "",
        role: "",
        hireDate: getIstanbulToday(),
        annualLeaveDaysOverride: "",
      })
      toast({ title: "Personel oluşturuldu" })
    } catch (error) {
      toast({ title: "Personel kaydedilemedi", description: error instanceof Error ? error.message : "Tekrar deneyin.", variant: "destructive" })
    } finally {
      setSavingPhoto(false)
    }
  }

  const onSubmitEdit = async (data: EmployeeFormValues) => {
    if (!editEmployee) return
    try {
      setSavingPhoto(true)
      const photoPath = editPhoto ? await uploadEmployeePhoto(editPhoto) : editPhotoRemoved ? null : undefined
      await updateMutation.mutateAsync({
        id: editEmployee.id,
        data: {
          name: data.name,
          department: data.department,
          role: data.role,
          hireDate: data.hireDate,
          annualLeaveDaysOverride: data.annualLeaveDaysOverride === "" ? null : Number(data.annualLeaveDaysOverride),
          ...(photoPath !== undefined ? { photoPath } : {}),
        },
      })
      invalidateRelatedViews()
      setEditEmployee(null)
      setEditPhoto(null)
      toast({ title: "Personel güncellendi" })
    } catch (error) {
      toast({ title: "Personel güncellenemedi", description: error instanceof Error ? error.message : "Tekrar deneyin.", variant: "destructive" })
    } finally {
      setSavingPhoto(false)
    }
  }

  const toggleStatus = (employee: Employee) => {
    updateMutation.mutate({
      id: employee.id,
      data: { status: employee.status === "active" ? "inactive" : "active" },
    }, {
      onSuccess: () => {
        invalidateRelatedViews()
        toast({ title: employee.status === "active" ? "Personel pasife alındı" : "Personel aktifleştirildi" })
      },
      onError: (error) => toast({ title: "Durum değiştirilemedi", description: error.message, variant: "destructive" }),
    })
  }

  const removeEmployee = () => {
    if (!deletingEmployee || user?.role !== "manager") return
    deleteMutation.mutate({ id: deletingEmployee.id }, {
      onSuccess: () => {
        invalidateRelatedViews()
        setDeletingEmployee(null)
        toast({ title: "Personel listeden kaldırıldı", description: "İzin, mesai ve çalışma geçmişi korunuyor." })
      },
      onError: (error) => toast({ title: "Personel kaldırılamadı", description: error.message, variant: "destructive" }),
    })
  }

  const filteredEmployees = employees.filter((employee) =>
    employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.employeeNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.department.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "tr-TR", { sensitivity: "base" })
      || a.employeeNumber.localeCompare(b.employeeNumber, "tr-TR")
    if (sortBy === "department") {
      return a.department.localeCompare(b.department, "tr-TR", { sensitivity: "base" }) || byName
    }
    if (sortBy === "status") {
      return (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || byName
    }
    return byName
  })

  return (
    <Layout>
      <div className="flex-1 overflow-auto px-4 py-6 sm:p-8 flex flex-col">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Personel Yönetimi</h1>
            <p className="text-muted-foreground mt-1">{employees.length} kayıtlı personel</p>
          </div>

          <Dialog open={isCreateOpen} onOpenChange={(open) => {
            if (!open && (savingPhoto || createMutation.isPending)) return
            setIsCreateOpen(open)
            if (open) {
              setCreateHireDateMode("today")
              form.setValue("hireDate", getIstanbulToday())
            } else if (!savingPhoto && !createMutation.isPending) {
              setCreatePhoto(null)
            }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Yeni Personel</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Yeni Personel Ekle</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitCreate)} className="space-y-4">
                  <EmployeePhotoPicker file={createPhoto} onFileChange={setCreatePhoto} onRemove={() => setCreatePhoto(null)} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="employeeNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sicil No</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ad Soyad</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="department" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Departman</FormLabel>
                        {departments.length === 0 ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex flex-col gap-2">
                            <p>Kayıtlı departman yok.</p>
                            <Link href="/departments" className="font-bold underline text-amber-900">Departman oluşturun</Link>
                          </div>
                        ) : (
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Departman seçin" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {departments.map((department) => (
                                <SelectItem key={department.id} value={department.name}>{department.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="role" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Görev</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="hireDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>İşe Giriş Tarihi</FormLabel>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={createHireDateMode === "today" ? "default" : "outline"}
                          onClick={() => {
                            setCreateHireDateMode("today")
                            form.setValue("hireDate", getIstanbulToday(), { shouldValidate: true })
                          }}
                        >
                          Bugün başladı
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={createHireDateMode === "past" ? "default" : "outline"}
                          onClick={() => {
                            setCreateHireDateMode("past")
                            if (field.value === getIstanbulToday()) form.setValue("hireDate", "", { shouldValidate: true })
                          }}
                        >
                          Geçmiş tarih
                        </Button>
                      </div>
                      {createHireDateMode === "past" && (
                        <FormControl><Input type="date" max={getIstanbulToday()} {...field} /></FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="annualLeaveDaysOverride" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Yıllık İzin Hakkı İstisnası (Gün)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          placeholder="Departman hakkını kullan"
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(event.target.value)}
                        />
                      </FormControl>
                      {quotaPreview(createDepartment, createOverride)}
                      <FormMessage />
                    </FormItem>
                  )} />
                  <DialogFooter>
                    <Button type="submit" disabled={savingPhoto || createMutation.isPending || departments.length === 0}>{savingPhoto || createMutation.isPending ? "Kaydediliyor..." : "Kaydet"}</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex-1 flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="İsim, sicil no veya departman ara..."
                className="pl-9"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                data-testid="input-search-employees"
              />
            </div>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Personel sıralaması" data-testid="select-employee-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alphabetical">Alfabetik (A–Z)</SelectItem>
                <SelectItem value="department">Departmana göre (A–Z)</SelectItem>
                <SelectItem value="status">Duruma göre (Aktif önce)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                <TableRow>
                  <TableHead className="w-[80px]">Sicil</TableHead>
                  <TableHead>Personel</TableHead>
                  <TableHead>Departman &amp; Görev</TableHead>
                  <TableHead className="text-right">Yıllık İzin</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="w-[140px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8">Yükleniyor...</TableCell></TableRow>
                ) : filteredEmployees.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Kayıt bulunamadı</TableCell></TableRow>
                ) : (
                  filteredEmployees.map((employee) => (
                    <TableRow key={employee.id} className={employee.status === "inactive" ? "opacity-50" : ""}>
                      <TableCell className="font-mono text-xs font-medium text-muted-foreground">{employee.employeeNumber}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8" style={{ backgroundColor: employee.avatarColor }}>
                            <AvatarImage src={employeePhotoUrl(employee.id, employee.photoPath)} className="object-cover" alt={`${employee.name} fotoğrafı`} />
                            <AvatarFallback className="bg-transparent text-white font-medium">
                              {employee.name.split(" ").map((name) => name[0]).join("").substring(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{employee.name}</span>
                            <span className={`text-xs ${employee.hireDate ? "text-muted-foreground" : "font-medium text-amber-700"}`}>
                              {employee.hireDate ? `İşe giriş: ${employee.hireDate.slice(0, 10)}` : "İşe giriş tarihi eksik"}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{employee.department}</span>
                          <span className="text-xs text-muted-foreground">{employee.role}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {employee.hireDate ? (
                          <div className="flex flex-col items-end" data-testid={`text-employee-annual-balance-${employee.id}`}>
                            {employee.remainingAnnualLeaveHours === null ? (
                              <span className="text-sm font-medium text-muted-foreground">Bakiye hesaplanamıyor</span>
                            ) : (
                              <span className="text-sm font-medium">{formatLeaveHours(employee.remainingAnnualLeaveHours)} kalan</span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              Kullanıldı: {formatLeaveHours(employee.usedLeaveHours)} · Beklemede: {formatLeaveHours(employee.pendingAnnualLeaveHours)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Hak: {formatLeaveHours(employee.annualLeaveHours)} ({employee.annualLeaveDaysOverride !== null ? "personel özel" : "departman"})
                            </span>
                            {employee.leaveCycleStart && employee.leaveCycleEnd && (
                              <span className="text-xs text-muted-foreground">{employee.leaveCycleStart.slice(0, 10)} – {employee.leaveCycleEnd.slice(0, 10)} dönemi</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-amber-700">İşe giriş tarihi eksik</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={employee.status === "active" ? "success" : "secondary"} className="capitalize">
                          {employee.status === "active" ? "Aktif" : "Pasif"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => setLocation(`/employees/${employee.id}/history`)} title="Çalışma Geçmişi">
                            <CalendarClock className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(employee)} title="Personeli düzenle">
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => toggleStatus(employee)}
                            title={employee.status === "active" ? "Pasife Al" : "Aktifleştir"}
                          >
                            <ShieldAlert className="h-4 w-4" />
                          </Button>
                          {user?.role === "manager" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeletingEmployee(employee)}
                              aria-label={`${employee.name} adlı personeli sil`}
                              title="Personeli sil"
                              data-testid={`button-delete-employee-${employee.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <Dialog open={!!editEmployee} onOpenChange={(open) => !open && !savingPhoto && !updateMutation.isPending && setEditEmployee(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Personel Düzenle: {editEmployee?.name}</DialogTitle>
            </DialogHeader>
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="space-y-4">
                <EmployeePhotoPicker
                  file={editPhoto}
                  existingUrl={editEmployee && !editPhotoRemoved ? employeePhotoUrl(editEmployee.id, editEmployee.photoPath) : undefined}
                  onFileChange={(file) => { setEditPhoto(file); setEditPhotoRemoved(false) }}
                  onRemove={() => { setEditPhoto(null); setEditPhotoRemoved(true) }}
                />
                <FormField control={editForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ad Soyad</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="department" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departman</FormLabel>
                    {departments.length === 0 ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex flex-col gap-2">
                        <p>Kayıtlı departman yok.</p>
                        <Link href="/departments" className="font-bold underline text-amber-900">Departman oluşturun</Link>
                      </div>
                    ) : (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Departman seçin" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {departments.map((department) => (
                            <SelectItem key={department.id} value={department.name}>{department.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Görev</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="hireDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>İşe Giriş Tarihi</FormLabel>
                    <div className="flex gap-2">
                      <FormControl><Input type="date" max={getIstanbulToday()} {...field} /></FormControl>
                      <Button type="button" variant="outline" onClick={() => editForm.setValue("hireDate", getIstanbulToday(), { shouldValidate: true })}>
                        Bugün
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="annualLeaveDaysOverride" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Yıllık İzin Hakkı İstisnası (Gün)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        placeholder="Departman hakkını kullan"
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    {quotaPreview(editDepartment, editOverride)}
                    <FormMessage />
                  </FormItem>
                )} />
                <DialogFooter>
                  <Button type="submit" disabled={savingPhoto || updateMutation.isPending || departments.length === 0}>{savingPhoto || updateMutation.isPending ? "Kaydediliyor..." : "Güncelle"}</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        <AlertDialog open={!!deletingEmployee} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeletingEmployee(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Personel listeden kaldırılsın mı?</AlertDialogTitle>
              <AlertDialogDescription>
                {deletingEmployee?.name} ({deletingEmployee?.employeeNumber}) personel listesinden ve yeni işlem seçimlerinden kaldırılacak.
                İzin, mesai ve çalışma geçmişi silinmeyecek. Bu işlem pasife almaktan farklıdır.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Vazgeç</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteMutation.isPending}
                onClick={(event) => { event.preventDefault(); removeEmployee() }}
                data-testid="button-confirm-delete-employee"
              >
                {deleteMutation.isPending ? "Kaldırılıyor..." : "Personeli sil"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  )
}