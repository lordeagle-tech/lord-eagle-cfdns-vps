import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useCreateServer, getListServersQueryKey, CreateServerBodyAuthType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Server, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const serverSchema = z.object({
  name: z.string().min(1, "Name is required"),
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().min(1).max(65535).default(22),
  username: z.string().min(1, "Username is required").default("root"),
  authType: z.enum(["password", "key"] as const).default("key"),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.authType === "password" && !data.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Password is required when auth type is password",
      path: ["password"]
    });
  }
  if (data.authType === "key" && !data.privateKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Private key is required when auth type is key",
      path: ["privateKey"]
    });
  }
});

type ServerFormValues = z.infer<typeof serverSchema>;

export default function AddServer() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<ServerFormValues>({
    resolver: zodResolver(serverSchema),
    defaultValues: {
      name: "",
      host: "",
      port: 22,
      username: "root",
      authType: "key",
      password: "",
      privateKey: "",
      passphrase: "",
      notes: ""
    }
  });

  const createMutation = useCreateServer({
    mutation: {
      onSuccess: (server) => {
        queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
        toast({ title: "Server added successfully" });
        setLocation(`/servers/${server.id}`);
      },
      onError: (error) => {
        toast({ 
          title: "Failed to add server", 
          description: error?.error || "Unknown error",
          variant: "destructive" 
        });
      }
    }
  });

  const onSubmit = (data: ServerFormValues) => {
    // Explicitly cast authType to the expected enum
    const payload = {
      ...data,
      authType: data.authType as CreateServerBodyAuthType
    };
    createMutation.mutate({ data: payload });
  };

  const authType = form.watch("authType");

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">
      <div className="mb-6">
        <Link href="/" className="inline-flex items-center text-sm font-mono text-muted-foreground hover:text-primary mb-4" data-testid="link-back">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
        </Link>
        <h1 className="text-3xl font-mono font-bold text-foreground tracking-tight flex items-center">
          <Server className="w-8 h-8 mr-3 text-primary" />
          Register_Node
        </h1>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">Identifier (Name)</FormLabel>
                    <FormControl>
                      <Input placeholder="prod-web-01" className="font-mono" {...field} data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">Hostname / IP</FormLabel>
                    <FormControl>
                      <Input placeholder="192.168.1.100" className="font-mono" {...field} data-testid="input-host" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">Username</FormLabel>
                    <FormControl>
                      <Input placeholder="root" className="font-mono" {...field} data-testid="input-username" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">SSH Port</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="22" className="font-mono" {...field} data-testid="input-port" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="border-t border-border pt-6">
              <FormField
                control={form.control}
                name="authType"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel className="font-mono">Authentication Method</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="key" data-testid="radio-auth-key" />
                          </FormControl>
                          <FormLabel className="font-mono font-normal">SSH Private Key</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="password" data-testid="radio-auth-pwd" />
                          </FormControl>
                          <FormLabel className="font-mono font-normal">Password</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {authType === "key" && (
              <div className="space-y-4 bg-muted/30 p-4 rounded-md border border-border/50">
                <FormField
                  control={form.control}
                  name="privateKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">Private Key (RSA/Ed25519)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..." 
                          className="font-mono text-xs min-h-[150px]" 
                          {...field} 
                          value={field.value || ''}
                          data-testid="input-privkey" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="passphrase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">Passphrase (Optional)</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Leave empty if none" className="font-mono" {...field} value={field.value || ''} data-testid="input-passphrase" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {authType === "password" && (
              <div className="space-y-4 bg-muted/30 p-4 rounded-md border border-border/50">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" className="font-mono" {...field} value={field.value || ''} data-testid="input-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono">Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Internal routing only, attached to DB cluster B..." className="font-mono" {...field} value={field.value || ''} data-testid="input-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={createMutation.isPending} className="font-mono font-bold" data-testid="btn-submit">
                {createMutation.isPending ? "Connecting..." : "Register Server"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
