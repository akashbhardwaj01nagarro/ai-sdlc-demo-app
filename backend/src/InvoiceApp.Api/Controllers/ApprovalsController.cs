using InvoiceApp.Api.Auth;
using InvoiceApp.Domain;
using Microsoft.AspNetCore.Mvc;

namespace InvoiceApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
// Admin passes the gate so it can reject, and gets the Domain's clear refusal when it approves.
[RequireRole(ApprovalRoles.Manager, ApprovalRoles.Director, ApprovalRoles.Admin)]
public class ApprovalsController : ApiControllerBase
{
    private readonly ApprovalService _approvals;

    public ApprovalsController(ApprovalService approvals)
    {
        _approvals = approvals;
    }

    public record RejectRequest(string Reason);

    [HttpPost("{invoiceId}/approve")]
    public ActionResult<Invoice> Approve(string invoiceId)
    {
        var session = HttpContext.GetSession();
        return Handle(() => _approvals.Approve(invoiceId, new Approver(session.Username, session.Role)));
    }

    [HttpPost("{invoiceId}/reject")]
    public ActionResult<Invoice> Reject(string invoiceId, [FromBody] RejectRequest request) =>
        Handle(() => _approvals.Reject(invoiceId, HttpContext.GetSession().Username, request.Reason));
}
