"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Trash2,
  Plus,
  LogIn,
  LogOut,
  CheckCircle2,
  Bell,
  BellOff,
} from "lucide-react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

const SESSION_KEY = "flatmate-cleaning-session-v1";

type Task = {
  id: string;
  name: string;
  points: number;
  category: string;
};

type Roommate = {
  id: string;
  name: string;
  points: number;
  created_at?: string;
};

type TaskLog = {
  id: string;
  roommate_id: string;
  roommate_name: string;
  task_ids: string[];
  task_names: string[];
  delta: number;
  created_at: string;
};

type WeekHistoryItem = {
  id: string;
  added: number;
  created_at: string;
};

type TabKey = "tasks" | "admin" | "history";

function getSavedSession(): string {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function saveSession(roommateId: string): void {
  localStorage.setItem(SESSION_KEY, roommateId);
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleString();
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export default function FlatmateCleaningApp() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("tasks");

  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [weekHistory, setWeekHistory] = useState<WeekHistoryItem[]>([]);

  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [newRoommate, setNewRoommate] = useState<string>("");
  const [newTaskName, setNewTaskName] = useState<string>("");
  const [newTaskPoints, setNewTaskPoints] = useState<string>("-2");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");

  const weeklyPoints = 21;

  async function loadAllData(): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    const [
      roommatesResult,
      tasksResult,
      logsResult,
      weeklyResult,
    ] = await Promise.all([
      supabase.from("roommates").select("*").order("created_at", { ascending: true }),
      supabase.from("tasks").select("*").order("name", { ascending: true }),
      supabase.from("task_logs").select("*").order("created_at", { ascending: false }),
      supabase.from("weekly_resets").select("*").order("created_at", { ascending: false }),
    ]);

    if (roommatesResult.error || tasksResult.error || logsResult.error || weeklyResult.error) {
      setErrorMessage(
        roommatesResult.error?.message ||
          tasksResult.error?.message ||
          logsResult.error?.message ||
          weeklyResult.error?.message ||
          "Failed to load data."
      );
      setLoading(false);
      return;
    }

    setRoommates((roommatesResult.data || []) as Roommate[]);
    setTasks((tasksResult.data || []) as Task[]);
    setLogs((logsResult.data || []) as TaskLog[]);
    setWeekHistory((weeklyResult.data || []) as WeekHistoryItem[]);
    setLoading(false);
  }

  useEffect(() => {
    setMounted(true);
    const savedSession = getSavedSession();
    if (savedSession) setCurrentUserId(savedSession);
    void loadAllData();
    if ("Notification" in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const currentUser = useMemo<Roommate | null>(
    () => roommates.find((r) => r.id === currentUserId) || null,
    [roommates, currentUserId]
  );

  const totalNegativeTaskCost = useMemo<number>(() => {
    return Math.abs(
      tasks
        .filter((task) => selectedTaskIds.includes(task.id))
        .reduce((sum, task) => sum + task.points, 0)
    );
  }, [selectedTaskIds, tasks]);

  const rankedRoommates = useMemo<Roommate[]>(() => {
    return [...roommates].sort((a, b) => a.points - b.points);
  }, [roommates]);

  const fairnessHint = useMemo<string>(() => {
    const pts = roommates.map((r) => r.points);
    if (pts.length === 0) return "";
    const max = Math.max(...pts);
    const min = Math.min(...pts);
    const gap = max - min;
    if (gap <= 3) return "Very fair right now.";
    if (gap <= 7) return "Slight imbalance. Still manageable.";
    return "Noticeable imbalance. Ask high-point users to take more tasks or skip kitchen use more often.";
  }, [roommates]);

  function handleLogin(id: string): void {
    setCurrentUserId(id);
    saveSession(id);
  }

  async function enableNotifications(): Promise<void> {
    if (!currentUser || !("serviceWorker" in navigator)) return;

    const permission = await Notification.requestPermission();
    setNotifPermission(permission);
    if (permission !== "granted") return;

    const reg = await navigator.serviceWorker.register("/sw.js");
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_PUBLIC_KEY,
    });

    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roommateId: currentUser.id, subscription: sub }),
    });
  }

  function handleLogout(): void {
    setCurrentUserId("");
    clearSession();
  }

  async function addRoommate(): Promise<void> {
    const name = newRoommate.trim();
    if (!name) return;

    const { error } = await supabase.from("roommates").insert({
      name,
      points: weeklyPoints,
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setNewRoommate("");
    await loadAllData();
  }

  async function removeRoommate(id: string): Promise<void> {
    if (currentUserId === id) handleLogout();

    const { error } = await supabase.from("roommates").delete().eq("id", id);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    await loadAllData();
  }

  async function addCustomTask(): Promise<void> {
    const name = newTaskName.trim();
    const points = Number(newTaskPoints);

    if (!name || Number.isNaN(points) || points >= 0) return;

    const customId = `custom-${crypto.randomUUID()}`;

    const { error } = await supabase.from("tasks").insert({
      id: customId,
      name,
      points,
      category: "Custom",
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setNewTaskName("");
    setNewTaskPoints("-2");
    await loadAllData();
  }

  function toggleTask(taskId: string): void {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId]
    );
  }

  async function submitTaskLog(): Promise<void> {
    if (!currentUser || selectedTaskIds.length === 0) return;

    const chosenTasks = tasks.filter((t) => selectedTaskIds.includes(t.id));
    const delta = chosenTasks.reduce((sum, t) => sum + t.points, 0);
    const newPoints = currentUser.points + delta;

    const updateRoommate = await supabase
      .from("roommates")
      .update({ points: newPoints })
      .eq("id", currentUser.id);

    if (updateRoommate.error) {
      setErrorMessage(updateRoommate.error.message);
      return;
    }

    const insertLog = await supabase.from("task_logs").insert({
      roommate_id: currentUser.id,
      roommate_name: currentUser.name,
      task_ids: selectedTaskIds,
      task_names: chosenTasks.map((t) => t.name),
      delta,
    });

    if (insertLog.error) {
      setErrorMessage(insertLog.error.message);
      return;
    }

    setSelectedTaskIds([]);
    await loadAllData();
  }

  async function deleteTaskLog(logId: string): Promise<void> {
    const targetLog = logs.find((log) => log.id === logId);
    if (!targetLog) return;

    const targetRoommate = roommates.find((r) => r.id === targetLog.roommate_id);
    if (!targetRoommate) return;

    const revertedPoints = targetRoommate.points - targetLog.delta;

    const updateRoommate = await supabase
      .from("roommates")
      .update({ points: revertedPoints })
      .eq("id", targetRoommate.id);

    if (updateRoommate.error) {
      setErrorMessage(updateRoommate.error.message);
      return;
    }

    const deleteLog = await supabase.from("task_logs").delete().eq("id", logId);

    if (deleteLog.error) {
      setErrorMessage(deleteLog.error.message);
      return;
    }

    await loadAllData();
  }

  async function deleteTask(taskId: string): Promise<void> {
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId));
    await loadAllData();
  }

  async function deleteWeeklyReset(weekId: string): Promise<void> {
    const targetWeek = weekHistory.find((week) => week.id === weekId);
    if (!targetWeek) return;

    const results = await Promise.all(
      roommates.map((r) =>
        supabase
          .from("roommates")
          .update({ points: r.points - targetWeek.added })
          .eq("id", r.id)
      )
    );

    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setErrorMessage(failed.error.message);
      return;
    }

    const deleteReset = await supabase.from("weekly_resets").delete().eq("id", weekId);

    if (deleteReset.error) {
      setErrorMessage(deleteReset.error.message);
      return;
    }

    await loadAllData();
  }

  if (!mounted) {
    return <div className="p-6 text-sm text-slate-500">Loading...</div>;
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading shared data...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Flatmate Kitchen Fairness Tracker
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              A points-based cleaning rota where people who use the kitchen more
              are expected to offset it fairly.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Weekly base: +{weeklyPoints} pts</Badge>
            <Badge variant="outline">Shared live via Supabase</Badge>
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="rounded-2xl shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle>How the system works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <p>
                Everyone receives <strong>+{weeklyPoints} points each week</strong>.
                Those points represent how much kitchen burden they still owe the flat.
              </p>
              <p>
                To bring points down, a roommate either <strong>does cleaning tasks</strong>{" "}
                or <strong>does not use the kitchen</strong> that day.
              </p>
              <p>
                Lower points are better. If someone keeps cooking but does not help clean,
                their score stays high relative to others.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!currentUser ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Choose your name once. This browser keeps you logged in.
                  </p>
                  <div className="grid gap-2">
                    {roommates.map((roommate) => (
                      <Button
                        key={roommate.id}
                        variant="outline"
                        className="justify-start rounded-xl"
                        onClick={() => void handleLogin(roommate.id)}
                      >
                        <LogIn className="mr-2 h-4 w-4" />
                        {roommate.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-slate-500">Logged in as</p>
                    <p className="text-xl font-semibold">{currentUser.name}</p>
                  </div>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={handleLogout}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </Button>
                  {notifPermission !== "granted" ? (
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => void enableNotifications()}
                    >
                      <Bell className="mr-2 h-4 w-4" />
                      Enable daily reminder
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <BellOff className="h-4 w-4" />
                      Reminders on
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="rounded-2xl shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle>Fairness board</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">{fairnessHint}</p>
              <div className="space-y-3">
                {rankedRoommates.map((r, index) => {
                  const maxPts = Math.max(
                    weeklyPoints * 2,
                    ...roommates.map((x) => x.points),
                    1
                  );
                  const progressValue = clamp((r.points / maxPts) * 100, 0, 100);

                  return (
                    <div key={r.id} className="rounded-xl border bg-white p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-500">#{index + 1}</span>
                          <span className="font-medium">{r.name}</span>
                          {currentUserId === r.id && <Badge>You</Badge>}
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold">{r.points}</div>
                          <div className="text-xs text-slate-500">lower is better</div>
                        </div>
                      </div>
                      <Progress value={progressValue} className="h-2" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Weekly actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
                Points are added automatically every Sunday at midnight.
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <div className="grid w-full grid-cols-3 rounded-2xl bg-muted p-1">
            <button
              type="button"
              onClick={() => setActiveTab("tasks")}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                activeTab === "tasks"
                  ? "bg-white text-black shadow-sm"
                  : "text-slate-600"
              }`}
            >
              Log tasks
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("admin")}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                activeTab === "admin"
                  ? "bg-white text-black shadow-sm"
                  : "text-slate-600"
              }`}
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                activeTab === "history"
                  ? "bg-white text-black shadow-sm"
                  : "text-slate-600"
              }`}
            >
              History
            </button>
          </div>

          {activeTab === "tasks" && (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="rounded-2xl shadow-sm lg:col-span-2">
                <CardHeader>
                  <CardTitle>Choose what you did today</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!currentUser ? (
                    <div className="rounded-xl bg-slate-100 p-4 text-sm text-slate-700">
                      Log in as a roommate first.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        {tasks.map((task) => (
                          <label
                            key={task.id}
                            className="flex cursor-pointer items-start gap-3 rounded-xl border bg-white p-4"
                          >
                            <Checkbox
                              checked={selectedTaskIds.includes(task.id)}
                              onCheckedChange={() => toggleTask(task.id)}
                            />
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{task.name}</span>
                                <Badge variant="secondary">{task.points} pts</Badge>
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {task.category}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>

                      <div className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            This submission will reduce your score by
                          </span>
                          <span className="text-xl font-bold">
                            {totalNegativeTaskCost}
                          </span>
                        </div>
                      </div>

                      <Button className="rounded-xl" onClick={() => void submitTaskLog()}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Submit today’s actions
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle>Recommended point model</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <p><strong>Start / weekly top-up:</strong> +21 points</p>
                  <p><strong>Did not use kitchen today:</strong> -3</p>
                  <p><strong>Food waste:</strong> -5</p>
                  <p><strong>General waste:</strong> -4</p>
                  <p><strong>Bottle / glass waste:</strong> -4</p>
                  <p><strong>Clean sink:</strong> -3</p>
                  <p><strong>Clean IH surface:</strong> -2</p>
                  <div className="rounded-xl bg-slate-100 p-3">
                    Logic: +21 per week matches 7 days × 3 points. If someone does
                    not use the kitchen for all 7 days, their weekly net change is 0.
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "admin" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle>Manage roommates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={newRoommate}
                      onChange={(e) => setNewRoommate(e.target.value)}
                      placeholder="New roommate name"
                      className="rounded-xl"
                    />
                    <Button onClick={() => void addRoommate()} className="rounded-xl">
                      <Plus className="mr-2 h-4 w-4" />
                      Add
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {roommates.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-xl border p-3"
                      >
                        <div>
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-slate-500">
                            Current points: {r.points}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void removeRoommate(r.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle>Add custom task</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Task name</Label>
                    <Input
                      value={newTaskName}
                      onChange={(e) => setNewTaskName(e.target.value)}
                      placeholder="e.g. Deep clean the counter"
                      className="rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Point value (negative)</Label>
                    <Input
                      type="number"
                      value={newTaskPoints}
                      onChange={(e) => setNewTaskPoints(e.target.value)}
                      className="rounded-xl"
                    />
                  </div>

                  <Button onClick={() => void addCustomTask()} className="rounded-xl">
                    Add task
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm lg:col-span-2">
                <CardHeader>
                  <CardTitle>Manage tasks</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between rounded-xl border p-3"
                    >
                      <div>
                        <div className="font-medium">{task.name}</div>
                        <div className="text-xs text-slate-500">
                          {task.category} · {task.points} pts
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void deleteTask(task.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "history" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle>Task log</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {logs.length === 0 ? (
                    <p className="text-sm text-slate-500">No task logs yet.</p>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold">{log.roommate_name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {fmtDate(log.created_at)}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-sm">
                              {log.delta} pts
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void deleteTaskLog(log.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {log.task_names.map((taskName, index) => (
                            <Badge key={`${log.id}-${index}`} variant="outline">
                              {taskName}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle>Weekly reset history</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {weekHistory.length === 0 ? (
                    <p className="text-sm text-slate-500">No weekly resets yet.</p>
                  ) : (
                    weekHistory.map((week) => (
                      <div key={week.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">
                              Added +{week.added} points to everyone
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {fmtDate(week.created_at)}
                            </div>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void deleteWeeklyReset(week.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}