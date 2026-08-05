import { Check, Minus } from "lucide-react";
import {
  PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, STAFF_ROLE_LABELS, type Permission, type StaffRole,
} from "@/lib/permissions";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Read-only permission matrix. Roles are the columns, permissions are the rows,
 * and every cell is derived from ROLE_PERMISSIONS — there is no hardcoded copy.
 * Adding a role or permission in `@/lib/permissions` is the only change needed.
 */
export function PermissionMatrix() {
  const rows: Permission[] = Object.values(PERMISSIONS);

  const has = (role: StaffRole, perm: Permission): boolean =>
    (ROLE_PERMISSIONS[role] ?? []).includes(perm);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-heading font-semibold text-foreground">Permission matrix</h2>
        <p className="text-xs text-muted-foreground">
          What each role in your agency can do.
        </p>
      </div>

      <div className="rounded-xl border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Permission</TableHead>
              {Object.values(STAFF_ROLES).map((r) => (
                <TableHead key={r} className="text-center min-w-[90px]">
                  {STAFF_ROLE_LABELS[r].label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((perm) => (
              <TableRow key={perm}>
                <TableCell className="font-mono text-[11px] text-muted-foreground align-middle">
                  {perm}
                </TableCell>
                {Object.values(STAFF_ROLES).map((r) => (
                  <TableCell key={r} className="text-center">
                    <MatrixCell on={has(r, perm)} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MatrixCell({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-6 h-6 rounded-full mx-auto",
        on
          ? "bg-success/10 text-success"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {on ? <Check className="w-3.5 h-3.5" /> : <Minus className="w-3 h-3" />}
    </span>
  );
}
