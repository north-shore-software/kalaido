import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { SignIn, SignUp } from "./cloud-auth-panel.stories";

describe("CloudAuthPanel", () => {
  test("sign-in mode shows the mode cards and the form", () => {
    renderStory(<SignIn />);
    expect(screen.getByText("Access existing workspaces")).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  test("sign-up mode renders", () => {
    renderStory(<SignUp />);
    expect(screen.getByText("Create a new account")).toBeInTheDocument();
  });
});
