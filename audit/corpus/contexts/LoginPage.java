// Adapted from https://github.com/Thangarajtk/appium-mobileAutomationFramework/blob/07e00ade6654e5e7bfba00bc95a2aed20960df40/src/main/java/com/automate/pages/LoginPage.java
// MIT License, see LICENSES.md. Changed: string values anonymized (pseudo-words).

package com.automate.pages;

import com.automate.entity.LoginData;
import com.automate.enums.WaitStrategy;
import com.automate.pages.screen.ScreenActions;
import io.appium.java_client.MobileElement;
import io.appium.java_client.pagefactory.AndroidFindBy;
import io.appium.java_client.pagefactory.iOSXCUITFindBy;

public final class LoginPage extends ScreenActions {

  @AndroidFindBy(accessibility = "kuva-Guvosusu")
  @iOSXCUITFindBy(accessibility = "kuva-Guvosusu")
  private static MobileElement txtFieldUsername;

  @AndroidFindBy(accessibility = "kuva-Zokubawe")
  @iOSXCUITFindBy(accessibility = "kuva-Zokubawe")
  private static MobileElement txtFieldPassword;

  @AndroidFindBy(accessibility = "kuva-DANOB")
  @iOSXCUITFindBy(accessibility = "kuva-DANOB")
  private static MobileElement btnLogin;

  @AndroidFindBy(xpath = "//android.view.ViewGroup[@content-desc='kuva-Notal mabetim']/android.widget.TextView")
  private static MobileElement errorMessage;

  public boolean isLoginPageDisplayed() {
    return isElementDisplayed(txtFieldUsername);
  }

  public LoginPage setUsername(String username) {
    enter(txtFieldUsername, username, "Username");
    return this;
  }

  public LoginPage setPassword(String password) {
    enter(txtFieldPassword, password, "Password");
    return this;
  }

  public ProductPage tapOnLogin() {
    click(btnLogin, "Login");
    return new ProductPage();
  }

  public ProductPage login(LoginData loginData) {
    setUsername(loginData.getLoginUsername())
      .setPassword(loginData.getLoginPassword())
      .tapOnLogin();

    return new ProductPage();
  }

  public String getErrorText() {
    return getText(errorMessage, WaitStrategy.VISIBLE);
  }
}
