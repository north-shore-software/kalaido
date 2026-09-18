import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import {
  SignedIn,
  SignedInNoName,
  SignInNotice,
} from "./cloud-identity-panel.stories";

describe("CloudIdentityPanel", () => {
  test("shows the account name and the sign-out escape hatch", () => {
    renderStory(<SignedIn />);
    expect(screen.getByText("Louis Collard")).toBeInTheDocument();
    expect(screen.getByText("Not you? Sign out")).toBeInTheDocument();
  });

  test("falls back to the email when there is no name", () => {
    renderStory(<SignedInNoName />);
    expect(screen.getByText("louis@example.com")).toBeInTheDocument();
  });

  test("the signed-out notice offers sign in", () => {
    renderStory(<SignInNotice />);
    expect(screen.getByText("You're not signed in")).toBeInTheDocument();
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });
});
