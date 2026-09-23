import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Calendar as CalendarIcon, Save } from "lucide-react";
import { type StrengthConfig, defaultStrengthConfig, type StrengthSpecialRule, type StrengthBand } from "@/lib/strength";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRosterConfigQueryKey } from "@workspace/api-client-react";
import { SG_PH_META_MAP } from "@/lib/usePHActuals";

export default function StrengthTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/roster-plan/config", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        // Server always includes a normalized `strength` object (backend
        // self-heals on read) — this fallback only matters if the fetch
        // above somehow returns a stale/partial shape.
        if (!data.strength) data.strength = defaultStrengthConfig();
        setConfig(data);
        setLoading(false);
      })
      .catch(() => {
        toast({ title: "Failed to load config", variant: "destructive" });
        setLoading(false);
      });
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/roster-plan/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config),
      });
      if (r.ok) {
        setConfig(await r.json());
        await queryClient.invalidateQueries({ queryKey: getGetRosterConfigQueryKey() });
        toast({ title: "Strength settings saved." });
      } else {
        const error = await r.json().catch(() => ({}));
        toast({ title: error.error || "Failed to save settings", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error saving settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!config) return null;

  const st = config.strength as StrengthConfig;

  const updateStrength = (path: string[], value: any) => {
    setConfig((prev: any) => {
      const next = { ...prev };
      const newStrength = JSON.parse(JSON.stringify(prev.strength)); // deep clone
      let curr = newStrength;
      // path is always a hardcoded literal array at every call site below
      // (["weekday","special"], ["colors","below"], …), never user input —
      // and this is client-side React state, not a shared server object.
      for (let i = 0; i < path.length - 1; i++) {
        curr = curr[path[i]]; // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
      }
      curr[path[path.length - 1]] = value;
      next.strength = newStrength;
      return next;
    });
  };

  const addSpecialRule = (type: "weekday" | "weekend") => {
    const defaults = st[type].default;
    const newRule: StrengthSpecialRule = {
      id: `rule-${Date.now()}`,
      name: `Exception ${st[type].special.length + 1}`,
      dates: [],
      minimum: defaults.minimum,
      full: defaults.full,
      shiftMinimums: { ...defaults.shiftMinimums },
    };
    updateStrength([type, "special"], [...st[type].special, newRule]);
  };

  const removeSpecialRule = (type: "weekday" | "weekend", id: string) => {
    updateStrength([type, "special"], st[type].special.filter((r) => r.id !== id));
  };

  const updateRuleDates = (type: "weekday" | "weekend", id: string, dates: Date[] | undefined) => {
    const validDates = dates || [];
    const dateStrings = validDates.map(d => format(d, "yyyy-MM-dd"));
    updateStrength([type, "special"], st[type].special.map((r) => r.id === id ? { ...r, dates: dateStrings } : r));
  };

  const renderShiftMinimumEditor = (
    band: StrengthBand,
    onChange: (b: StrengthBand) => void,
  ) => (
    <div className="grid grid-cols-3 gap-3">
      {(["PD", "DAY", "ND"] as const).map((duty) => (
        <div key={duty} className="space-y-1">
          <Label className="text-xs text-muted-foreground">{duty} min</Label>
          <Input
            type="number"
            className="h-8 text-sm"
            value={band.shiftMinimums[duty]}
            min={0}
            onChange={(event) => onChange({
              ...band,
              shiftMinimums: {
                ...band.shiftMinimums,
                [duty]: Math.max(0, parseInt(event.target.value) || 0),
              },
            })}
          />
        </div>
      ))}
    </div>
  );

  const renderSpecialRules = (type: "weekday" | "weekend") => (
    <div className="space-y-3 pt-4 border-t mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{type === "weekday" ? "Weekday" : "Weekend / PH"} Exceptions</h4>
          <p className="text-xs text-muted-foreground">Name each set, select one or more dates, then set the PD, DAY, and ND minimums.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => addSpecialRule(type)} className="gap-1 h-7 text-xs">
          <Plus className="h-3 w-3" /> Add Exception
        </Button>
      </div>

      {st[type].special.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No special date rules configured.</p>
      ) : (
        <div className="space-y-3">
          {st[type].special.map((rule) => (
            <div key={rule.id} className="flex flex-col gap-3 bg-muted/30 p-3 rounded-md border border-muted">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground w-12">Name</Label>
                <Input
                  value={rule.name}
                  placeholder="e.g. Major event coverage"
                  className="h-8"
                  onChange={(event) => updateStrength(
                    [type, "special"],
                    st[type].special.map((item) => item.id === rule.id ? { ...item, name: event.target.value } : item),
                  )}
                />
              </div>
               <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-[220px] justify-start text-left font-normal bg-background shrink-0">
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                      {rule.dates.length > 0 ? `${rule.dates.length} date(s) selected` : "Select dates..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                     <Calendar
                       mode="multiple"
                       selected={rule.dates.map((d) => new Date(d + "T00:00:00"))}
                       onSelect={(dates) => updateRuleDates(type, rule.id, dates)}
                        disabled={(date) => {
                          const isWeekend = [0, 6].includes(date.getDay());
                          const isPH = Boolean(SG_PH_META_MAP[format(date, "yyyy-MM-dd")]);
                          return type === "weekday" ? isWeekend || isPH : !isWeekend && !isPH;
                        }}
                     />
                  </PopoverContent>
                </Popover>

                <div className="flex-1">
                  {renderShiftMinimumEditor(rule, (value) => updateStrength(
                    [type, "special"],
                    st[type].special.map((item) => item.id === rule.id ? value as StrengthSpecialRule : item),
                  ))}
                </div>

                <Button variant="ghost" size="icon" onClick={() => removeSpecialRule(type, rule.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {rule.dates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {rule.dates.map((d) => (
                    <span key={d} className="text-[10px] bg-background border px-1.5 py-0.5 rounded text-muted-foreground font-medium">
                      {format(new Date(d + "T00:00:00"), "d MMM yyyy")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
        Strength is configured here and used throughout the roster, vehicle, and deployment views.
        Save Config publishes the same settings to every role and device.
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        {/* Weekday */}
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <h3 className="font-semibold">Weekday</h3>
          <p className="text-xs text-muted-foreground pb-2">Red below 24, yellow from 24 to 26, green from 27.</p>
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Default shift minimums</div>
              <label className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                <input
                  type="checkbox"
                  checked
                  readOnly
                  aria-label="Weekday values are set as default"
                  className="h-4 w-4 accent-emerald-600"
                />
                Set as default
              </label>
            </div>
            {renderShiftMinimumEditor(st.weekday.default, (value) => updateStrength(["weekday", "default"], value))}
          </div>
          {renderSpecialRules("weekday")}
        </div>

        {/* Weekend */}
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <h3 className="font-semibold">Weekend / PH</h3>
          <p className="text-xs text-muted-foreground pb-2">Red below 12 and green from 12. No yellow tier by default.</p>
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Default shift minimums</div>
              <label className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                <input
                  type="checkbox"
                  checked
                  readOnly
                  aria-label="Weekend and public holiday values are set as default"
                  className="h-4 w-4 accent-emerald-600"
                />
                Set as default
              </label>
            </div>
            {renderShiftMinimumEditor(st.weekend.default, (value) => updateStrength(["weekend", "default"], value))}
          </div>
          {renderSpecialRules("weekend")}
        </div>
      </div>

      {/* Colors */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <h3 className="font-semibold border-b pb-2">Appearance</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label className="text-sm">Below Minimum</Label>
            <div className="flex gap-2 items-center">
              <input type="color" className="h-9 w-12 p-0.5 cursor-pointer bg-background border rounded" value={st.colors.below} onChange={(e) => updateStrength(["colors", "below"], e.target.value)} />
              <Input value={st.colors.below} onChange={(e) => updateStrength(["colors", "below"], e.target.value)} className="h-9 font-mono uppercase" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Minimum Reached</Label>
            <div className="flex gap-2 items-center">
              <input type="color" className="h-9 w-12 p-0.5 cursor-pointer bg-background border rounded" value={st.colors.minimum} onChange={(e) => updateStrength(["colors", "minimum"], e.target.value)} />
              <Input value={st.colors.minimum} onChange={(e) => updateStrength(["colors", "minimum"], e.target.value)} className="h-9 font-mono uppercase" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Full Strength</Label>
            <div className="flex gap-2 items-center">
              <input type="color" className="h-9 w-12 p-0.5 cursor-pointer bg-background border rounded" value={st.colors.full} onChange={(e) => updateStrength(["colors", "full"], e.target.value)} />
              <Input value={st.colors.full} onChange={(e) => updateStrength(["colors", "full"], e.target.value)} className="h-9 font-mono uppercase" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving} className="w-36 gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving..." : "Save Config"}
        </Button>
      </div>
    </div>
  );
}
