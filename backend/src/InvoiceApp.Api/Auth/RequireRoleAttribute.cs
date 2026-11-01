using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace InvoiceApp.Api.Auth;

/// <summary>Allows the action only for the listed roles; everyone else gets 403.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public class RequireRoleAttribute : ActionFilterAttribute
{
    private readonly string[] _roles;

    public RequireRoleAttribute(params string[] roles)
    {
        _roles = roles;
    }

    public override void OnActionExecuting(ActionExecutingContext context)
    {
        var session = context.HttpContext.Items[HttpContextExtensions.SessionKey] as UserSession;

        if (session is null || !_roles.Contains(session.Role))
        {
            var role = session?.Role;
            var shownRole = string.IsNullOrWhiteSpace(role) ? "none" : role;
            context.Result = new ObjectResult(new
            {
                error = $"Your role ({shownRole}) cannot do this. Allowed roles: {string.Join(", ", _roles)}."
            })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
        }
    }
}
