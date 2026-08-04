import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { RosterVersionProvider } from "@/context/RosterVersionContext";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Officers from "@/pages/Officers";
import Users from "@/pages/Users";

import TodaysRoster from "@/pages/TodaysRoster";
import MySchedule from "@/pages/MySchedule";
import CrewSchedule from "@/pages/CrewSchedule";
import SwapLeaveApply from "@/pages/SwapLeaveApply";
import MyApplications from "@/pages/MyApplications";
import ApplicationsManage from "@/pages/ApplicationsManage";
import RosterCycle from "@/pages/RosterCycle";
import UploadBrief from "@/pages/UploadBrief";
import PHHoliday from "@/pages/PHHoliday";

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  const isManagement = user.role === "admin" || user.role === "manager" || user.role === "ic";

  return (
    <Layout>
      <Switch>
        <Route path="/login"><Redirect to="/" /></Route>
        <Route path="/register"><Redirect to="/" /></Route>

        {/* Today's Roster — all roles */}
        <Route path="/" component={TodaysRoster} />

        {/* Management routes */}
        {isManagement && <Route path="/crew-schedule" component={CrewSchedule} />}
        {isManagement && <Route path="/applications" component={ApplicationsManage} />}
        {(user.role === "admin" || user.role === "manager") && <Route path="/officers" component={Officers} />}
        {user.role === "admin" && <Route path="/users" component={Users} />}

        {/* Crew-only routes */}
        {user.role === "crew" && <Route path="/schedule" component={MySchedule} />}

        {/* Brief upload — management only */}
        {isManagement && <Route path="/upload-brief" component={UploadBrief} />}

        {/* Leave/Swap application — management only */}
        {isManagement && <Route path="/apply" component={SwapLeaveApply} />}

        {/* My leave/swap status — crew only */}
        {user.role === "crew" && <Route path="/my-applications" component={MyApplications} />}

        {/* Roster Cycle — all roles */}
        <Route path="/roster-cycle" component={RosterCycle} />

        {/* Public Holiday — all roles */}
        <Route path="/public-holiday" component={PHHoliday} />

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RosterVersionProvider>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppRoutes />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
      </RosterVersionProvider>
    </QueryClientProvider>
  );
}

export default App;
