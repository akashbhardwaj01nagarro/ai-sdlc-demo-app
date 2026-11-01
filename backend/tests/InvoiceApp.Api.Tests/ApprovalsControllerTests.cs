using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using InvoiceApp.Api.Auth;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace InvoiceApp.Api.Tests;

/// <summary>
/// POST /api/approvals/{invoiceId}/approve and /reject over HTTP against the real app, row by row of
/// specs/001-approval-limits/contracts/approvals-api.md: sign-in, the role gate, ApiControllerBase's mapping of
/// service errors to status codes, and the JSON the UI reads. The rules themselves are tested in InvoiceApp.Tests;
/// these tests check that each answer reaches the client with the status and body the contract gives. Every test
/// signs in through POST /api/auth/login and creates its own invoices; the seeded invoices are never used.
/// </summary>
public class ApprovalsControllerTests : IClassFixture<InvoiceAppFactory>
{
    private const string CustomerName = "Riverside College";
    private const string RejectReason = "Duplicate invoice";

    // An account with the former Approver role, which appsettings.json no longer ships: a role that is neither
    // Manager, Director nor Admin, added through configuration.
    private const string LegacyUsername = "demo.legacy";
    private const string LegacyRole = "Approver";

    private readonly InvoiceAppFactory _factory;

    public ApprovalsControllerTests(InvoiceAppFactory factory) => _factory = factory;

    // Contract row "Approved (final)". FR-001 and FR-002 at their limits, and the second approval above 500,000.00
    // by a different Director, which keeps the first approval (FR-003).
    public static TheoryData<string?, string, decimal> FinalApprovals => new()
    {
        { null, "demo.manager", 50000.00m },
        { null, "demo.director", 500000.00m },
        { "demo.director", "demo.director2", 600000.00m },
    };

    // 200 with the invoice: every field as before the attempt except the decision, whose approver is the signed-in
    // user, so the approver comes from the session and the answer carries the new state.
    [Theory]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-002")]
    [Trait("Rule", "FR-003")]
    [MemberData(nameof(FinalApprovals))]
    public async Task Approve_FinalApprovalAnswers200WithTheApprovedInvoice(
        string? firstApprover, string approver, decimal amount)
    {
        var id = await CreatePendingInvoiceAsync(_factory, amount);
        if (firstApprover is not null)
        {
            await GiveFirstApprovalAsync(firstApprover, id);
        }

        var client = await _factory.SignInAsync(approver);
        var before = await GetInvoiceAsync(client, id);
        var earliest = DateTime.UtcNow;

        using var response = await ApproveAsync(client, id);

        var latest = DateTime.UtcNow;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var approved = await JsonBody.ReadAsync(response);
        AssertRecordedBetween(earliest, latest, approved["decidedAt"]);
        var expected = new Dictionary<string, object?>(before)
        {
            ["status"] = "Approved",
            ["decidedBy"] = approver,
            ["decidedAt"] = approved["decidedAt"],
        };
        Assert.Equal(expected, approved);
    }

    // Contract row "First of two approvals recorded": 200 with firstApprovedBy and firstApprovedAt, which the UI
    // reads to show who gave the first approval (FR-008); every other field, status PendingApproval and the empty
    // decision included, as before the attempt.
    [Fact]
    [Trait("Rule", "FR-003")]
    public async Task Approve_FirstApprovalAboveTheDirectorLimitAnswers200WithTheInvoiceStillPending()
    {
        var id = await CreatePendingInvoiceAsync(_factory, 500000.01m);
        var director = await _factory.SignInAsync("demo.director");
        var before = await GetInvoiceAsync(director, id);
        var earliest = DateTime.UtcNow;

        using var response = await ApproveAsync(director, id);

        var latest = DateTime.UtcNow;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var invoice = await JsonBody.ReadAsync(response);
        AssertRecordedBetween(earliest, latest, invoice["firstApprovedAt"]);
        var expected = new Dictionary<string, object?>(before)
        {
            ["firstApprovedBy"] = "demo.director",
            ["firstApprovedAt"] = invoice["firstApprovedAt"],
        };
        Assert.Equal(expected, invoice);
    }

    // Contract row "Invoice not found". INV-404 is never issued: new invoices are numbered from INV-1007 up.
    [Fact]
    [Trait("Rule", "FR-005")]
    public async Task Approve_UnknownInvoiceAnswers404WithTheReason()
    {
        var director = await _factory.SignInAsync("demo.director");

        using var response = await ApproveAsync(director, "INV-404");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var expected = new Dictionary<string, object?> { ["error"] = "Invoice INV-404 was not found." };
        Assert.Equal(expected, await JsonBody.ReadAsync(response));
    }

    // Contract row "Invoice not pending": a second final approval of an approved invoice.
    [Fact]
    [Trait("Rule", "FR-005")]
    public async Task Approve_InvoiceThatIsNotPendingAnswers409WithTheReasonAndChangesNothing()
    {
        var id = await CreatePendingInvoiceAsync(_factory, 100.00m);
        var manager = await _factory.SignInAsync("demo.manager");
        using (var approval = await ApproveAsync(manager, id))
        {
            Assert.Equal(HttpStatusCode.OK, approval.StatusCode);
        }

        var director = await _factory.SignInAsync("demo.director");
        var before = await GetInvoiceAsync(director, id);

        using var response = await ApproveAsync(director, id);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var expected = new Dictionary<string, object?>
        {
            ["error"] = $"Invoice {id} is Approved; only pending invoices can be decided.",
        };
        Assert.Equal(expected, await JsonBody.ReadAsync(response));
        Assert.Equal(before, await GetInvoiceAsync(director, id));
    }

    // Contract row "Refused by an approval rule", once per ApprovalRefusal code. {id} stands for the invoice's id.
    // The first approval, where a row has one, is given in its own session, so the repeat by demo.director is a
    // new sign-in of the same user. Admin passes the role gate, so its refusal is the Domain's (R-02).
    public static TheoryData<string?, string, decimal, string, string> RefusedApprovals => new()
    {
        {
            null, "demo.manager", 50000.01m, "AmountAboveRoleLimit",
            "Approval refused: invoice {id} is 50,000.01, above the 50,000.00 limit for the Manager role. " +
            "A Director must approve it."
        },
        {
            "demo.director", "demo.director", 600000.00m, "SameApproverTwice",
            "Approval refused: you gave the first approval for invoice {id}, " +
            "so the second approval must come from a different Director."
        },
        {
            "demo.director", "demo.manager", 600000.00m, "DirectorRequired",
            "Approval refused: invoice {id} is above 500,000.00, so its second approval must come from a Director. " +
            "Your role is Manager."
        },
        {
            null, "demo.admin", 100.00m, "RoleCannotApprove",
            "Approval refused: invoice {id} cannot be approved by the Admin role. " +
            "Only Managers and Directors can approve invoices."
        },
    };

    // 403 with exactly { error, code }: not 409, which an InvalidOperationException would give, not 500, which
    // Forbid() without an authentication scheme gives, and not the role gate's 403 without code. The invoice,
    // including a recorded first approval, is unchanged.
    [Theory]
    [Trait("Rule", "FR-005")]
    [Trait("Rule", "FR-001")]
    [Trait("Rule", "FR-003")]
    [Trait("Rule", "FR-004")]
    [Trait("Rule", "FR-006")]
    [MemberData(nameof(RefusedApprovals))]
    public async Task Approve_RefusedByAnApprovalRuleAnswers403WithTheReasonAndCodeAndChangesNothing(
        string? firstApprover, string approver, decimal amount, string expectedCode, string expectedError)
    {
        var id = await CreatePendingInvoiceAsync(_factory, amount);
        if (firstApprover is not null)
        {
            await GiveFirstApprovalAsync(firstApprover, id);
        }

        var client = await _factory.SignInAsync(approver);
        var before = await GetInvoiceAsync(client, id);

        using var response = await ApproveAsync(client, id);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var expected = new Dictionary<string, object?>
        {
            ["error"] = expectedError.Replace("{id}", id),
            ["code"] = expectedCode,
        };
        Assert.Equal(expected, await JsonBody.ReadAsync(response));
        Assert.Equal(before, await GetInvoiceAsync(client, id));
    }

    // R-04. A role that is neither Manager, Director nor Admin reaches the Domain, as Admin does, and gets its
    // refusal: the code and a reason that names the role and the invoice. Fails while ApprovalsController keeps
    // the role gate on the whole class, because the gate answers first with its 403 without code or invoice.
    [Fact]
    [Trait("Rule", "FR-006")]
    [Trait("Rule", "FR-005")]
    public async Task Approve_ByARoleOtherThanManagerDirectorOrAdminAnswers403WithTheDomainReasonAndCode()
    {
        await using var factory = _factory.WithUser(LegacyUsername, DemoAccounts.Password, LegacyRole);
        var id = await CreatePendingInvoiceAsync(factory, 100.00m);
        var legacy = await factory.SignInAsync(LegacyUsername, LegacyRole);
        var before = await GetInvoiceAsync(legacy, id);

        using var response = await ApproveAsync(legacy, id);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var expected = new Dictionary<string, object?>
        {
            ["error"] =
                $"Approval refused: invoice {id} cannot be approved by the Approver role. " +
                "Only Managers and Directors can approve invoices.",
            ["code"] = "RoleCannotApprove",
        };
        Assert.Equal(expected, await JsonBody.ReadAsync(response));
        Assert.Equal(before, await GetInvoiceAsync(legacy, id));
    }

    // Contract row "Not signed in": 401 with an empty body from the sign-in middleware, before the role gate or
    // the controller runs, and the invoice unchanged. A token the server never issued counts as no token.
    public static TheoryData<string?> AuthorizationHeadersWithoutASession => new()
    {
        null,
        "Bearer not-a-session-token",
    };

    [Theory]
    [Trait("Rule", "sign-in")]
    [MemberData(nameof(AuthorizationHeadersWithoutASession))]
    public async Task Approve_WithoutASessionAnswers401AndChangesNothing(string? authorization)
    {
        var id = await CreatePendingInvoiceAsync(_factory, 100.00m);
        var director = await _factory.SignInAsync("demo.director");
        var before = await GetInvoiceAsync(director, id);
        var anonymous = _factory.CreateClient();
        if (authorization is not null)
        {
            anonymous.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", authorization);
        }

        using var response = await ApproveAsync(anonymous, id);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(string.Empty, await response.Content.ReadAsStringAsync());
        Assert.Equal(before, await GetInvoiceAsync(director, id));
    }

    // FR-007 and R-02: every role the gate lets in can reject, Admin included, and the amount does not limit it:
    // 600,000.00 is above every single-approver limit. 200 with the invoice: every field as before except the
    // decision, whose approver is the signed-in user, and the reason.
    [Theory]
    [Trait("Rule", "FR-007")]
    [InlineData("demo.admin")]
    [InlineData("demo.manager")]
    [InlineData("demo.director")]
    public async Task Reject_ByARoleTheGateAllowsAnswers200WithTheRejectedInvoice(string username)
    {
        var id = await CreatePendingInvoiceAsync(_factory, 600000.00m);
        var client = await _factory.SignInAsync(username);
        var before = await GetInvoiceAsync(client, id);
        var earliest = DateTime.UtcNow;

        using var response = await RejectAsync(client, id);

        var latest = DateTime.UtcNow;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rejected = await JsonBody.ReadAsync(response);
        AssertRecordedBetween(earliest, latest, rejected["decidedAt"]);
        var expected = new Dictionary<string, object?>(before)
        {
            ["status"] = "Rejected",
            ["decidedBy"] = username,
            ["decidedAt"] = rejected["decidedAt"],
            ["decisionNote"] = RejectReason,
        };
        Assert.Equal(expected, rejected);
    }

    // R-04: Reject keeps the role gate (Manager, Director, Admin), so a role outside it gets the gate's 403, the
    // contract row "Role not allowed by the gate", and the invoice is unchanged. Passes with the gate on the class
    // and on the Reject action alike; fails if moving the gate drops it from Reject.
    [Fact]
    [Trait("Rule", "FR-007")]
    public async Task Reject_ByARoleOtherThanManagerDirectorOrAdminAnswers403FromTheRoleGateAndChangesNothing()
    {
        await using var factory = _factory.WithUser(LegacyUsername, DemoAccounts.Password, LegacyRole);
        var id = await CreatePendingInvoiceAsync(factory, 100.00m);
        var legacy = await factory.SignInAsync(LegacyUsername, LegacyRole);
        var before = await GetInvoiceAsync(legacy, id);

        using var response = await RejectAsync(legacy, id);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var expected = new Dictionary<string, object?>
        {
            ["error"] = "Your role (Approver) cannot do this. Allowed roles: Manager, Director, Admin.",
        };
        Assert.Equal(expected, await JsonBody.ReadAsync(response));
        Assert.Equal(before, await GetInvoiceAsync(legacy, id));
    }

    private static Task<HttpResponseMessage> ApproveAsync(HttpClient client, string id) =>
        client.PostAsync($"/api/approvals/{id}/approve", content: null);

    private static Task<HttpResponseMessage> RejectAsync(HttpClient client, string id) =>
        client.PostAsJsonAsync($"/api/approvals/{id}/reject", new { reason = RejectReason });

    // A new invoice, created and submitted through the API by demo.admin. Returns its id.
    private static async Task<string> CreatePendingInvoiceAsync(WebApplicationFactory<SessionStore> factory, decimal amount)
    {
        var author = await factory.SignInAsync("demo.admin");
        using var created = await author.PostAsJsonAsync("/api/invoices", new { customerName = CustomerName, amount });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = Assert.IsType<string>((await JsonBody.ReadAsync(created))["id"]);

        using var submitted = await author.PostAsync($"/api/invoices/{id}/submit", content: null);
        Assert.Equal(HttpStatusCode.OK, submitted.StatusCode);
        var invoice = await JsonBody.ReadAsync(submitted);
        Assert.Equal("PendingApproval", invoice["status"]);
        Assert.Equal(amount, invoice["amount"]);
        return id;
    }

    // The first of two approvals above 500,000.00, given in a session of its own.
    private async Task GiveFirstApprovalAsync(string firstApprover, string id)
    {
        var client = await _factory.SignInAsync(firstApprover);
        using var response = await ApproveAsync(client, id);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var invoice = await JsonBody.ReadAsync(response);
        Assert.Equal("PendingApproval", invoice["status"]);
        Assert.Equal(firstApprover, invoice["firstApprovedBy"]);
    }

    // The invoice as GET /api/invoices/{id} returns it: what the UI shows after a reload.
    private static async Task<IReadOnlyDictionary<string, object?>> GetInvoiceAsync(HttpClient client, string id)
    {
        using var response = await client.GetAsync($"/api/invoices/{id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await JsonBody.ReadAsync(response);
    }

    // A time the server recorded while handling the request: UTC, between the test's clock readings taken before
    // and after it (the in-memory server reads the same system clock).
    private static void AssertRecordedBetween(DateTime earliest, DateTime latest, object? value)
    {
        var text = Assert.IsType<string>(value);
        var recorded = DateTime.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        Assert.Equal(DateTimeKind.Utc, recorded.Kind);
        Assert.InRange(recorded, earliest, latest);
    }
}
