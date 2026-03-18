"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Trash2, Plus, RotateCcw, LogIn, LogOut, CheckCircle2, AlertTriangle } from "lucide-react";

const STORAGE_KEY = "flatmate-cleaning-mvp-v1";
const SESSION_KEY = "flatmate-cleaning-session-v1";

const DEFAULT_WEEKLY_POINTS = 12;
const DEFAULT_TASKS = [
  { id: "food", name: "Food waste", points: -3, category: "Waste" },
  { id: "general", name: "General waste", points: -2, category: "Waste" },
  { id: "bottle", name: "Bottle / glass waste", points: -2, category: "Waste" },
  { id: "sink", name: "Clean the sink", points: -3, category: "Cleaning" },
  { id: "ih", name: "Clean the IH surface", points: -2, category: "Cleaning" },
  { id: "nokitchen", name: "Did not use kitchen today", points: -2, category: "Usage" },
];

const DEFAULT_STATE = {
  flatName: "Mayflower Kitchen",
  weeklyPoints: DEFAULT_WEEKLY_POINTS,
  roommates: [
    { id: crypto.randomUUID(), name: "Masahiro", points: 12 },
    { id: crypto.randomUUID(), name: "Flatmate A", points: 12 },
    { id: crypto.randomUUID(), name: "Flatmate B", points: 12 },
  ],
  tasks: DEFAULT_TASKS,
  logs: [],
  weekHistory: [],
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getSavedSession() {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function saveSession(roommateId) {
  localStorage.setItem(SESSION_KEY, roommateId);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default function FlatmateCleaningApp() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [currentUserId, setCurrentUserId] = useState("");
  const [newRoommate, setNewRoommate] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskPoints, setNewTaskPoints] = useState(-2);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);

  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
    const savedSession = getSavedSession();
    if (savedSession) setCurrentUserId(savedSession);
  }, []);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const currentUser = useMemo(
    () => state.roommates.find((r) => r.id === currentUserId) || null,
    [state.roommates, currentUserId]
  );

  const totalNegativeTaskCost = useMemo(() => {
    return Math.abs(
      state.tasks
        .filter((task) => selectedTaskIds.includes(task.id))
        .reduce((sum, task) => sum + task.points, 0)
    );
  }, [selectedTaskIds, state.tasks]);

  const rankedRoommates = useMemo(() => {
    return [...state.roommates].sort((a, b) => a.points - b.points);
  }, [state.roommates]);

  const fairnessHint = useMemo(() => {
    const pts = state.roommates.map((r) => r.points);
    if (pts.length === 0) return "";
    const max = Math.max(...pts);
    const min = Math.min(...pts);
    const gap = max - min;
    if (gap <= 3) return "Very fair right now.";
    if (gap <= 7) return "Slight imbalance. Still manageable.";
    return "Noticeable imbalance. Ask high-point users to take more tasks or skip kitchen use more often.";
  }, [state.roommates]);

  function updateState(updater) {
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveState(next);
      return next;
    });
  }

  function handleLogin(id) {
    setCurrentUserId(id);
    saveSession(id);
  }

  function handleLogout() {
    setCurrentUserId("");
    clearSession();
  }

  function addRoommate() {
    const name = newRoommate.trim();
    if (!name) return;
    updateState((prev) => ({
      ...prev,
      roommates: [
        ...prev.roommates,
        { id: crypto.randomUUID(), name, points: prev.weeklyPoints },
      ],
    }));
    setNewRoommate("");
  }

  function removeRoommate(id) {
    updateState((prev) => ({
      ...prev,
      roommates: prev.roommates.filter((r) => r.id !== id),
      logs: prev.logs.filter((log) => log.roommateId !== id),
    }));
    if (currentUserId === id) handleLogout();
  }

  function addCustomTask() {
    const name = newTaskName.trim();
    const points = Number(newTaskPoints);
    if (!name || Number.isNaN(points) || points >= 0) return;
    updateState((prev) => ({
      ...prev,
      tasks: [
        ...prev.tasks,
        { id: crypto.randomUUID(), name, points, category: "Custom" },
      ],
    }));
    setNewTaskName("");
    setNewTaskPoints(-2);
  }

  function toggleTask(taskId) {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  }

  function submitTaskLog() {
    if (!currentUser || selectedTaskIds.length === 0) return;
    const chosenTasks = state.tasks.filter((t) => selectedTaskIds.includes(t.id));
    const delta = chosenTasks.reduce((sum, t) => sum + t.points, 0);
    const entry = {
      id: crypto.randomUUID(),
      roommateId: currentUser.id,
      roommateName: currentUser.name,
      taskIds: selectedTaskIds,
      taskNames: chosenTasks.map((t) => t.name),
      delta,
      createdAt: new Date().toISOString(),
    };

    updateState((prev) => ({
      ...prev,
      roommates: prev.roommates.map((r) =>
        r.id === currentUser.id ? { ...r, points: r.points + delta } : r
      ),
      logs: [entry, ...prev.logs],
    }));
    setSelectedTaskIds([]);
  }

  function runWeeklyReset() {
    updateState((prev) => ({
      ...prev,
      roommates: prev.roommates.map((r) => ({
        ...r,
        points: r.points + prev.weeklyPoints,
      })),
      weekHistory: [
        {
          id: crypto.randomUUID(),
          added: prev.weeklyPoints,
          createdAt: new Date().toISOString(),
        },
        ...prev.weekHistory,
      ],
    }));
  }

  function resetDemo() {
    setState(DEFAULT_STATE);
    saveState(DEFAULT_STATE);
    setSelectedTaskIds([]);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Flatmate Kitchen Fairness Tracker</h1>
            <p className="text-sm text-slate-600 mt-1">
              A points-based cleaning rota where people who use the kitchen more are expected to offset it fairly.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Weekly base: +{state.weeklyPoints} pts</Badge>
            <Badge variant="outline">Shared on one link later</Badge>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>How the system works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <p>
                Everyone receives <strong>+{state.weeklyPoints} points each week</strong>. Those points represent how much kitchen burden they still owe the flat.
              </p>
              <p>
                To bring points down, a roommate either <strong>does cleaning tasks</strong> or <strong>does not use the kitchen</strong> that day.
              </p>
              <p>
                Lower points are better. If someone keeps cooking but does not help clean, their score stays high relative to others.
              </p>
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <p>
                  This MVP stores data in the browser for demo purposes. For a real shareable app with persistent login across devices, the next step is a tiny backend with Supabase.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!currentUser ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">Choose your name once. This browser keeps you logged in.</p>
                  <div className="grid gap-2">
                    {state.roommates.map((roommate) => (
                      <Button
                        key={roommate.id}
                        variant="outline"
                        className="justify-start rounded-xl"
                        onClick={() => handleLogin(roommate.id)}
                      >
                        <LogIn className="mr-2 h-4 w-4" /> {roommate.name}
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
                  <Button variant="outline" className="rounded-xl" onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" /> Log out
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle>Fairness board</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">{fairnessHint}</p>
              <div className="space-y-3">
                {rankedRoommates.map((r, index) => {
                  const maxPts = Math.max(state.weeklyPoints * 2, ...state.roommates.map((x) => x.points), 1);
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
            <CardContent className="space-y-3">
              <Button className="w-full rounded-xl" onClick={runWeeklyReset}>
                <RotateCcw className="mr-2 h-4 w-4" /> Add weekly points to everyone
              </Button>
              <Button variant="outline" className="w-full rounded-xl" onClick={resetDemo}>
                Reset demo data
              </Button>
              <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
                Suggestion: run the weekly update every Sunday evening.
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="tasks" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 rounded-2xl">
            <TabsTrigger value="tasks">Log tasks</TabsTrigger>
            <TabsTrigger value="admin">Settings</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="tasks">
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2 rounded-2xl shadow-sm">
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
                        {state.tasks.map((task) => (
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
                              <div className="text-xs text-slate-500 mt-1">{task.category}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">This submission will reduce your score by</span>
                          <span className="text-xl font-bold">{totalNegativeTaskCost}</span>
                        </div>
                      </div>
                      <Button className="rounded-xl" onClick={submitTaskLog}>
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Submit today’s actions
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
                  <p><strong>Start / weekly top-up:</strong> +12 points</p>
                  <p><strong>Did not use kitchen today:</strong> -2</p>
                  <p><strong>Food waste:</strong> -3</p>
                  <p><strong>General waste:</strong> -2</p>
                  <p><strong>Bottle / glass waste:</strong> -2</p>
                  <p><strong>Clean sink:</strong> -3</p>
                  <p><strong>Clean IH surface:</strong> -2</p>
                  <div className="rounded-xl bg-slate-100 p-3">
                    Logic: a normal active cook can get back to near zero by doing a few small tasks plus one bigger cleaning task each week.
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="admin">
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
                    <Button onClick={addRoommate} className="rounded-xl">
                      <Plus className="mr-2 h-4 w-4" /> Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {state.roommates.map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded-xl border p-3">
                        <div>
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-slate-500">Current points: {r.points}</div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeRoommate(r.id)}>
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
                  <Button onClick={addCustomTask} className="rounded-xl">Add task</Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle>Task log</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {state.logs.length === 0 ? (
                    <p className="text-sm text-slate-500">No task logs yet.</p>
                  ) : (
                    state.logs.map((log) => (
                      <div key={log.id} className="rounded-xl border p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{log.roommateName}</div>
                          <Badge variant="secondary">{log.delta} pts</Badge>
                        </div>
                        <div className="mt-2 text-sm text-slate-700">{log.taskNames.join(", ")}</div>
                        <div className="mt-1 text-xs text-slate-500">{fmtDate(log.createdAt)}</div>
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
                  {state.weekHistory.length === 0 ? (
                    <p className="text-sm text-slate-500">No weekly resets yet.</p>
                  ) : (
                    state.weekHistory.map((week) => (
                      <div key={week.id} className="rounded-xl border p-4">
                        <div className="font-medium">Added +{week.added} points to everyone</div>
                        <div className="text-xs text-slate-500 mt-1">{fmtDate(week.createdAt)}</div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
