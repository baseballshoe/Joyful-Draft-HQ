import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { AppLayout } from "./components/layout";
import Dashboard from "./pages/dashboard";
import Players from "./pages/players";
import ByPosition from "./pages/by-position";
import MyRoster from "./pages/my-roster";
import CheatSheet from "./pages/cheat-sheet";
import RoundStrategy from "./pages/round-strategy";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/players" component={Players} />
        <Route path="/by-position" component={ByPosition} />
        <Route path="/my-roster" component={MyRoster} />
        <Route path="/cheat-sheet" component={CheatSheet} />
        <Route path="/round-strategy" component={RoundStrategy} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
