import { useState } from "react";
import { Building2 } from "lucide-react";
import { useStaff } from "@/hooks/use-staff";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Shown when the signed-in user has no active Clerk Organization — i.e. they
 * are not an agency owner / property owner yet. Creating an org makes them the
 * org:admin and is the prerequisite for the rest of the Team page.
 */
export function CreateAgencyEmptyState() {
  const { createAgency } = useStaff();
  const [name, setName] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createAgency.mutate({ name: name.trim() });
  };

  return (
    <div className="max-w-md mx-auto py-12">
      <Card className="text-center">
        <CardHeader className="items-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
            <Building2 className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="font-heading">Create your agency</CardTitle>
          <CardDescription>
            Agencies map to Clerk Organizations. Create one to invite staff,
            manage roles, and share properties across your team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3 text-left">
            <div className="space-y-2">
              <Label htmlFor="agency-name" className="text-xs text-muted-foreground">
                Agency name
              </Label>
              <Input
                id="agency-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mogadishu Premium Rentals"
                className="h-11 rounded-xl"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              variant="hero"
              className="w-full"
              disabled={createAgency.isPending || !name.trim()}
            >
              {createAgency.isPending ? "Creating..." : "Create agency"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
